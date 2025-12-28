const express = require('express');
const http = require('http');
const socketIO = require('socket.io');
const cors = require('cors');
const { v4: uuidv4 } = require('uuid');
const BotAI = require('./botAI');

const app = express();
app.use(cors());
app.use(express.json());

const server = http.createServer(app);
const io = socketIO(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

const PORT = process.env.PORT || 3001;

// Almacenamiento de salas
const rooms = new Map();

// Clase para manejar una sala
class GameRoom {
  constructor(name, code, hostId) {
    this.name = name;
    this.code = code;
    this.hostId = hostId;
    this.players = new Map();
    this.bots = [];
    this.config = {
      impostorHasPista: true,
      numImpostors: 1,
      maxBots: 15,
      wordDelay: 15,
      voteDelay: 5,
      gameMode: 'classic', // 'classic' o 'roles'
      numMedics: 0,
      numDetectives: 0,
      numWriters: 0
    };
    this.gameState = 'waiting'; // waiting, revealing, playing, voting, finished
    this.currentWord = '';
    this.impostorPista = '';
    this.playersRevealed = new Set();
    this.currentPlayerIndex = 0;
    this.playerOrder = [];
    this.playerWords = new Map();
    this.votes = new Map();
    this.eliminatedPlayers = new Set();
    this.roundNumber = 1;
    this.usedWords = [];
    this.allWords = [
      'Perro', 'Gato', 'Pizza', 'Playa', 'Montaña', 'Coche', 'Avión',
      'Libro', 'Música', 'Fútbol', 'Ordenador', 'Café', 'Chocolate',
      'Luna', 'Sol', 'Árbol', 'Flor', 'Río', 'Mar', 'Ciudad',
      'Casa', 'Escuela', 'Hospital', 'Parque', 'Cine', 'Restaurante',
      'Invierno', 'Verano', 'Primavera', 'Otoño', 'Lluvia', 'Nieve',
      'Teléfono', 'Televisión', 'Radio', 'Internet', 'Email', 'Mensaje',
      'Familia', 'Amigos', 'Trabajo', 'Vacaciones', 'Fiesta', 'Cumpleaños',
      'Boda', 'Navidad', 'Año Nuevo', 'Halloween', 'Pascua', 'Carnaval',
      'Música Rock', 'Pop', 'Jazz', 'Clásica', 'Rap', 'Reggaeton',
      'Guitarra', 'Piano', 'Batería', 'Violín', 'Flauta', 'Trompeta',
      'Pintura', 'Escultura', 'Fotografía', 'Danza', 'Teatro', 'Cine',
      'Novela', 'Poesía', 'Cuento', 'Ensayo', 'Biografía', 'Historia',
      'Matemáticas', 'Física', 'Química', 'Biología', 'Geografía', 'Historia',
      'Desayuno', 'Almuerzo', 'Cena', 'Merienda', 'Postre', 'Aperitivo',
      'Pan', 'Arroz', 'Pasta', 'Carne', 'Pescado', 'Verduras',
      'Frutas', 'Lácteos', 'Huevos', 'Legumbres', 'Cereales', 'Frutos Secos',
      'Agua', 'Zumo', 'Refresco', 'Cerveza', 'Vino', 'Licor',
      'Rojo', 'Azul', 'Verde', 'Amarillo', 'Naranja', 'Morado',
      'Rosa', 'Marrón', 'Negro', 'Blanco', 'Gris', 'Dorado'
    ];
    // Sistema de roles (modo roles)
    this.roleAbilities = new Map(); // {playerId: {detective: {interrogated: []}, medic: {used: false}, writer: {used: false}}}
    this.wordHistory = []; // Historial de palabras por ronda para detectives
  }

  addPlayer(socketId, playerName) {
    const playerNum = this.players.size + 1;
    const defaultName = playerName || `Player${playerNum}`;
    this.players.set(socketId, {
      id: socketId,
      name: defaultName,
      role: null,
      isBot: false,
      revealed: false
    });
  }

  removePlayer(socketId) {
    this.players.delete(socketId);
    if (socketId === this.hostId && this.players.size > 0) {
      this.hostId = Array.from(this.players.keys())[0];
    }
  }

  addBot() {
    if (this.bots.length >= this.config.maxBots) return false;

    const botNum = this.bots.length + 1;
    const botId = `bot_${uuidv4()}`;
    const bot = {
      id: botId,
      name: `Bot${botNum}`,
      role: null,
      isBot: true,
      revealed: true,
      ai: new BotAI(botId)
    };
    this.bots.push(bot);
    return bot;
  }

  removeBot(botId) {
    const index = this.bots.findIndex(b => b.id === botId);
    if (index !== -1) {
      this.bots.splice(index, 1);
      return true;
    }
    return false;
  }

  updatePlayerName(socketId, newName) {
    const player = this.players.get(socketId);
    if (player) {
      player.name = newName;
      return true;
    }
    return false;
  }

  updateBotName(botId, newName) {
    const bot = this.bots.find(b => b.id === botId);
    if (bot) {
      bot.name = newName;
      return true;
    }
    return false;
  }

  updateConfig(config) {
    this.config = { ...this.config, ...config };
  }

  getAllPlayers() {
    return [
      ...Array.from(this.players.values()),
      ...this.bots
    ];
  }

  getAlivePlayers() {
    return this.getAllPlayers().filter(p => !this.eliminatedPlayers.has(p.id));
  }

  startGame() {
    if (this.gameState !== 'waiting') return false;

    const allPlayers = this.getAllPlayers();
    if (allPlayers.length < 3) return false;

    // Seleccionar palabra e impostores
    this.currentWord = this.generateWord();
    this.impostorPista = this.generatePista(this.currentWord);

    // Asignar roles aleatoriamente
    const shuffled = [...allPlayers].sort(() => Math.random() - 0.5);
    const numImpostors = Math.min(this.config.numImpostors, Math.floor(allPlayers.length / 2));

    for (let i = 0; i < allPlayers.length; i++) {
      const player = shuffled[i];
      if (i < numImpostors) {
        player.role = 'impostor';
      } else {
        player.role = 'civil';
      }
      player.specialRole = null; // Reset special roles

      // Los bots se revelan automáticamente
      if (player.isBot) {
        player.revealed = true;
        this.playersRevealed.add(player.id);
        // Inicializar IA del bot con información del juego
        player.ai.initialize(
          player.role,
          player.role === 'civil' ? this.currentWord : null,
          this.config.impostorHasPista ? this.impostorPista : null,
          allPlayers.map(p => ({ id: p.id, name: p.name, isBot: p.isBot }))
        );
      }
    }

    // Asignar roles especiales si el modo es 'roles'
    if (this.config.gameMode === 'roles') {
      this.assignSpecialRoles(allPlayers);
    }

    this.gameState = 'revealing';
    return true;
  }

  assignSpecialRoles(allPlayers) {
    // Separar civiles e impostores
    const civils = allPlayers.filter(p => p.role === 'civil');
    const impostors = allPlayers.filter(p => p.role === 'impostor');

    // Asignar Detectives (solo civiles)
    const shuffledCivils = [...civils].sort(() => Math.random() - 0.5);
    const numDetectives = Math.min(this.config.numDetectives || 0, civils.length);
    for (let i = 0; i < numDetectives; i++) {
      shuffledCivils[i].specialRole = 'detective';
      this.roleAbilities.set(shuffledCivils[i].id, {
        type: 'detective',
        interrogated: [],
        suspects: [],
        wordHistory: []
      });
    }

    // Asignar Médicos (solo civiles no asignados)
    const remainingCivils = shuffledCivils.filter(p => !p.specialRole);
    const numMedics = Math.min(this.config.numMedics || 0, remainingCivils.length);
    for (let i = 0; i < numMedics; i++) {
      remainingCivils[i].specialRole = 'medic';
      this.roleAbilities.set(remainingCivils[i].id, {
        type: 'medic',
        abilityUsed: false
      });
    }

    // Asignar Escritores (solo impostores)
    const shuffledImpostors = [...impostors].sort(() => Math.random() - 0.5);
    const numWriters = Math.min(this.config.numWriters || 0, impostors.length);
    for (let i = 0; i < numWriters; i++) {
      shuffledImpostors[i].specialRole = 'writer';
      this.roleAbilities.set(shuffledImpostors[i].id, {
        type: 'writer',
        usedThisRound: false
      });
    }
  }

  generateWord() {
    // Filtrar palabras usadas recientemente en esta sala
    const availableWords = this.allWords.filter(w => !this.usedWords.includes(w));
    const wordsToChoose = availableWords.length > 0 ? availableWords : this.allWords;

    const chosenWord = wordsToChoose[Math.floor(Math.random() * wordsToChoose.length)];

    // Añadir a usadas y mantener solo las últimas 2
    this.usedWords.push(chosenWord);
    if (this.usedWords.length > 2) {
      this.usedWords.shift();
    }

    return chosenWord;
  }

  generatePista(word) {
    const pistas = {
      'Perro': 'Animal doméstico', 'Gato': 'Animal doméstico', 'Pizza': 'Comida italiana',
      'Playa': 'Lugar vacacional', 'Montaña': 'Lugar natural', 'Coche': 'Vehículo',
      'Avión': 'Vehículo', 'Libro': 'Objeto de lectura', 'Música': 'Arte sonoro',
      'Fútbol': 'Deporte', 'Ordenador': 'Tecnología', 'Café': 'Bebida',
      'Chocolate': 'Dulce', 'Luna': 'Astro', 'Sol': 'Astro', 'Árbol': 'Planta',
      'Flor': 'Planta', 'Río': 'Agua', 'Mar': 'Agua', 'Ciudad': 'Lugar urbano',
      'Casa': 'Edificio', 'Escuela': 'Edificio educativo', 'Hospital': 'Edificio médico',
      'Parque': 'Lugar de ocio', 'Cine': 'Entretenimiento', 'Restaurante': 'Lugar de comida',
      'Invierno': 'Estación fría', 'Verano': 'Estación caliente', 'Primavera': 'Estación florida',
      'Otoño': 'Estación de hojas', 'Lluvia': 'Clima húmedo', 'Nieve': 'Clima frío',
      'Teléfono': 'Comunicación', 'Televisión': 'Entretenimiento', 'Radio': 'Audio',
      'Internet': 'Red global', 'Email': 'Mensaje digital', 'Mensaje': 'Comunicación',
      'Familia': 'Parentesco', 'Amigos': 'Relación social', 'Trabajo': 'Empleo',
      'Vacaciones': 'Descanso', 'Fiesta': 'Celebración', 'Cumpleaños': 'Aniversario',
      'Boda': 'Ceremonia', 'Navidad': 'Festividad', 'Año Nuevo': 'Inicio',
      'Halloween': 'Festividad', 'Pascua': 'Festividad', 'Carnaval': 'Festividad',
      'Música Rock': 'Género musical', 'Pop': 'Género musical', 'Jazz': 'Género musical',
      'Clásica': 'Género musical', 'Rap': 'Género musical', 'Reggaeton': 'Género musical',
      'Guitarra': 'Instrumento', 'Piano': 'Instrumento', 'Batería': 'Instrumento',
      'Violín': 'Instrumento', 'Flauta': 'Instrumento', 'Trompeta': 'Instrumento',
      'Pintura': 'Arte visual', 'Escultura': 'Arte 3D', 'Fotografía': 'Arte visual',
      'Danza': 'Arte corporal', 'Teatro': 'Arte escénico', 'Novela': 'Literatura',
      'Poesía': 'Literatura', 'Cuento': 'Literatura', 'Ensayo': 'Texto',
      'Biografía': 'Historia personal', 'Historia': 'Pasado', 'Matemáticas': 'Ciencia',
      'Física': 'Ciencia', 'Química': 'Ciencia', 'Biología': 'Ciencia de vida',
      'Geografía': 'Ciencia de lugares', 'Desayuno': 'Comida', 'Almuerzo': 'Comida',
      'Cena': 'Comida', 'Merienda': 'Snack', 'Postre': 'Dulce', 'Aperitivo': 'Entrante',
      'Pan': 'Alimento básico', 'Arroz': 'Cereal', 'Pasta': 'Carbohidrato',
      'Carne': 'Proteína', 'Pescado': 'Proteína marina', 'Verduras': 'Vegetal',
      'Frutas': 'Dulce natural', 'Lácteos': 'Derivado leche', 'Huevos': 'Proteína',
      'Legumbres': 'Vegetal', 'Cereales': 'Grano', 'Frutos Secos': 'Snack',
      'Agua': 'Líquido vital', 'Zumo': 'Bebida frutal', 'Refresco': 'Bebida gaseosa',
      'Cerveza': 'Bebida alcohólica', 'Vino': 'Bebida alcohólica', 'Licor': 'Bebida fuerte',
      'Rojo': 'Color', 'Azul': 'Color', 'Verde': 'Color', 'Amarillo': 'Color',
      'Naranja': 'Color', 'Morado': 'Color', 'Rosa': 'Color', 'Marrón': 'Color',
      'Negro': 'Color oscuro', 'Blanco': 'Color claro', 'Gris': 'Color neutro', 'Dorado': 'Color brillante'
    };
    return pistas[word] || 'Sin pista';
  }

  playerRevealed(playerId) {
    this.playersRevealed.add(playerId);
    const player = this.players.get(playerId);
    if (player) {
      player.revealed = true;
    }
  }

  allPlayersRevealed() {
    const humanPlayers = Array.from(this.players.values());
    return humanPlayers.every(p => this.playersRevealed.has(p.id));
  }

  startPlayingPhase() {
    if (this.gameState !== 'revealing') return false;

    this.gameState = 'playing';
    this.playerOrder = [...this.getAllPlayers()]
      .filter(p => !this.eliminatedPlayers.has(p.id))
      .sort(() => Math.random() - 0.5);
    this.currentPlayerIndex = 0;
    this.playerWords.clear();

    return true;
  }

  getCurrentPlayer() {
    if (this.currentPlayerIndex >= this.playerOrder.length) return null;
    return this.playerOrder[this.currentPlayerIndex];
  }

  submitWord(playerId, word) {
    const currentPlayer = this.getCurrentPlayer();
    if (!currentPlayer || currentPlayer.id !== playerId) return false;

    this.playerWords.set(playerId, word);

    // Agregar al historial de palabras para detectives
    const playerName = this.getAllPlayers().find(p => p.id === playerId)?.name || 'Unknown';
    this.wordHistory.push({
      round: this.roundNumber,
      playerId,
      playerName,
      word
    });

    // Notificar a los bots sobre la nueva palabra
    this.bots.forEach(bot => {
      if (!this.eliminatedPlayers.has(bot.id)) {
        bot.ai.observeWord(playerId, word, currentPlayer.name);
      }
    });

    this.currentPlayerIndex++;
    return true;
  }

  // Métodos para habilidades de roles
  interrogatePlayer(detectiveId, targetId) {
    const detective = this.getAllPlayers().find(p => p.id === detectiveId);
    const target = this.getAllPlayers().find(p => p.id === targetId);

    if (!detective || !target || detective.specialRole !== 'detective') {
      return { success: false, error: 'Detective inválido' };
    }

    const abilities = this.roleAbilities.get(detectiveId);
    if (!abilities || abilities.interrogated.includes(targetId)) {
      return { success: false, error: 'Ya interrogaste a este jugador' };
    }

    // Calcular precisión (25-70%)
    const accuracy = 25 + Math.floor(Math.random() * 46);
    const isAccurate = Math.random() * 100 < accuracy;

    // Determinar resultado
    let result;
    if (isAccurate) {
      result = target.role; // Respuesta correcta
    } else {
      result = target.role === 'civil' ? 'impostor' : 'civil'; // Respuesta incorrecta
    }

    // Registrar interrogación
    abilities.interrogated.push(targetId);

    return {
      success: true,
      targetName: target.name,
      result,
      accuracy,
      actualRole: target.role // Para verificación (no se muestra al jugador)
    };
  }

  removeVote(medicId, targetId) {
    const medic = this.getAllPlayers().find(p => p.id === medicId);

    if (!medic || medic.specialRole !== 'medic') {
      return { success: false, error: 'Médico inválido' };
    }

    const abilities = this.roleAbilities.get(medicId);
    if (!abilities || abilities.abilityUsed) {
      return { success: false, error: 'Ya usaste tu habilidad' };
    }

    // Contar votos actuales
    const voteCounts = this.countVotes();
    const currentVotes = voteCounts.get(targetId) || 0;

    if (currentVotes === 0) {
      return { success: false, error: 'Este jugador no tiene votos' };
    }

    // Encontrar un votante y eliminar su voto
    for (const [voterId, votedId] of this.votes.entries()) {
      if (votedId === targetId) {
        this.votes.delete(voterId);
        break;
      }
    }

    abilities.abilityUsed = true;

    const targetName = this.getAllPlayers().find(p => p.id === targetId)?.name || 'Unknown';
    return { success: true, targetName };
  }

  useWriterAbility(writerId, targetId, fakeWord) {
    const writer = this.getAllPlayers().find(p => p.id === writerId);
    const target = this.getAllPlayers().find(p => p.id === targetId);

    if (!writer || writer.specialRole !== 'writer') {
      return { success: false, error: 'Escritor inválido' };
    }

    if (!target || targetId === writerId) {
      return { success: false, error: 'Objetivo inválido' };
    }

    const abilities = this.roleAbilities.get(writerId);
    if (!abilities || abilities.usedThisRound) {
      return { success: false, error: 'Ya usaste tu habilidad esta ronda' };
    }

    // 50% de probabilidad de éxito
    const success = Math.random() < 0.5;

    abilities.usedThisRound = true;

    if (success && fakeWord) {
      // Cambiar la palabra del jugador objetivo
      const oldWord = target.role === 'civil' ? this.currentWord : null;

      // Guardar la palabra falsa para este jugador
      target.swappedWord = fakeWord;

      return {
        success: true,
        swapped: true,
        targetName: target.name,
        targetId: target.id
      };
    }

    return {
      success: true,
      swapped: false,
      targetName: target.name
    };
  }

  getWordForPlayer(playerId) {
    const player = this.getAllPlayers().find(p => p.id === playerId);
    if (!player) return null;

    // Si el escritor cambió su palabra
    if (player.swappedWord) {
      return player.swappedWord;
    }

    // Palabra normal según rol
    if (player.role === 'civil') {
      return this.currentWord;
    } else {
      return null; // Impostor no tiene palabra
    }
  }

  async getBotWord(bot) {
    // El bot genera su palabra usando IA
    const allWords = Array.from(this.playerWords.entries()).map(([id, word]) => {
      const player = this.getAllPlayers().find(p => p.id === id);
      return { playerId: id, playerName: player?.name || 'Unknown', word };
    });

    const word = await bot.ai.generateWord(allWords);
    return word;
  }

  allWordsSubmitted() {
    return this.currentPlayerIndex >= this.playerOrder.length;
  }

  startVoting() {
    if (this.gameState !== 'playing') return false;

    this.gameState = 'voting';
    this.votes.clear();
    return true;
  }

  submitVote(voterId, votedPlayerId) {
    if (this.gameState !== 'voting') return false;
    if (this.eliminatedPlayers.has(voterId)) return false;

    this.votes.set(voterId, votedPlayerId);
    return true;
  }

  async getBotVote(bot) {
    const allWords = Array.from(this.playerWords.entries()).map(([id, word]) => {
      const player = this.getAllPlayers().find(p => p.id === id);
      return { playerId: id, playerName: player?.name || 'Unknown', word };
    });

    const vote = await bot.ai.vote(allWords, Array.from(this.votes.values()));
    return vote;
  }

  allVotesCast() {
    const alivePlayers = this.getAlivePlayers();
    return alivePlayers.every(p => this.votes.has(p.id));
  }

  countVotes() {
    const voteCounts = new Map();

    for (const [voter, voted] of this.votes.entries()) {
      if (!this.eliminatedPlayers.has(voter) && !this.eliminatedPlayers.has(voted)) {
        voteCounts.set(voted, (voteCounts.get(voted) || 0) + 1);
      }
    }

    return voteCounts;
  }

  eliminatePlayer() {
    const voteCounts = this.countVotes();
    if (voteCounts.size === 0) return null;

    // Encontrar el jugador con más votos
    let maxVotes = 0;
    let eliminatedId = null;
    const tied = [];

    for (const [playerId, votes] of voteCounts.entries()) {
      if (votes > maxVotes) {
        maxVotes = votes;
        eliminatedId = playerId;
        tied.length = 0;
        tied.push(playerId);
      } else if (votes === maxVotes) {
        tied.push(playerId);
      }
    }

    // Si hay empate, devolver lista de empatados
    if (tied.length > 1) {
      return { tied: tied, eliminated: null };
    }

    this.eliminatedPlayers.add(eliminatedId);
    return { tied: null, eliminated: eliminatedId };
  }

  checkWinCondition() {
    const alivePlayers = this.getAlivePlayers();
    const aliveImpostors = alivePlayers.filter(p => p.role === 'impostor');
    const aliveCivils = alivePlayers.filter(p => p.role === 'civil');

    if (aliveImpostors.length === 0) {
      return 'civils'; // Civiles ganan
    }

    if (aliveCivils.length <= aliveImpostors.length) {
      return 'impostors'; // Impostores ganan
    }

    return null; // Continuar jugando
  }

  startNewRound() {
    this.roundNumber++;
    this.gameState = 'playing';
    this.playerOrder = this.getAlivePlayers().sort(() => Math.random() - 0.5);
    this.currentPlayerIndex = 0;
    this.playerWords.clear();
    this.votes.clear();

    // Resetear habilidad del escritor para nueva ronda
    this.roleAbilities.forEach((ability, playerId) => {
      if (ability.type === 'writer') {
        ability.usedThisRound = false;
      }
    });

    // Limpiar palabras cambiadas
    this.getAllPlayers().forEach(p => {
      delete p.swappedWord;
    });
  }

  resetForTiebreaker(tiedPlayerIds) {
    this.gameState = 'playing';
    this.currentPlayerIndex = 0;
    this.playerWords.clear();
    this.votes.clear();

    // Solo los jugadores empatados participan en el desempate
    if (tiedPlayerIds && tiedPlayerIds.length > 0) {
      this.playerOrder = this.getAllPlayers()
        .filter(p => tiedPlayerIds.includes(p.id))
        .sort(() => Math.random() - 0.5);
    }
  }

  getRoomInfo() {
    return {
      name: this.name,
      code: this.code,
      hostId: this.hostId,
      players: Array.from(this.players.values()).map(p => ({
        id: p.id,
        name: p.name,
        isHost: p.id === this.hostId
      })),
      bots: this.bots.map(b => ({
        id: b.id,
        name: b.name,
        isBot: true
      })),
      config: this.config,
      gameState: this.gameState,
      playerCount: this.players.size + this.bots.length
    };
  }
}

// Socket.IO eventos
io.on('connection', (socket) => {
  console.log('Cliente conectado:', socket.id);

  // Crear sala
  socket.on('createRoom', ({ roomName, playerName }, callback) => {
    const code = Math.random().toString(36).substring(2, 8).toUpperCase();
    const room = new GameRoom(roomName, code, socket.id);
    room.addPlayer(socket.id, playerName);
    rooms.set(code, room);

    socket.join(code);
    callback({ success: true, code, room: room.getRoomInfo() });
  });

  // Listar salas
  socket.on('listRooms', ({ searchQuery }, callback) => {
    const roomList = Array.from(rooms.values())
      .filter(room => room.gameState === 'waiting')
      .filter(room => !searchQuery || room.name.toLowerCase().includes(searchQuery.toLowerCase()))
      .map(room => ({
        name: room.name,
        code: room.code,
        playerCount: room.players.size + room.bots.length,
        hostName: room.players.get(room.hostId)?.name || 'Unknown'
      }));

    callback({ success: true, rooms: roomList });
  });

  // Unirse a sala
  socket.on('joinRoom', ({ code, playerName }, callback) => {
    const room = rooms.get(code);

    if (!room) {
      callback({ success: false, error: 'Sala no encontrada' });
      return;
    }

    if (room.gameState !== 'waiting') {
      callback({ success: false, error: 'La partida ya ha comenzado' });
      return;
    }

    room.addPlayer(socket.id, playerName);
    socket.join(code);

    io.to(code).emit('roomUpdated', room.getRoomInfo());
    callback({ success: true, room: room.getRoomInfo() });
  });

  // Añadir bot
  socket.on('addBot', ({ code }, callback) => {
    const room = rooms.get(code);

    if (!room || socket.id !== room.hostId) {
      callback({ success: false, error: 'No autorizado' });
      return;
    }

    const bot = room.addBot();
    if (bot) {
      io.to(code).emit('roomUpdated', room.getRoomInfo());
      callback({ success: true, bot });
    } else {
      callback({ success: false, error: 'Máximo de bots alcanzado' });
    }
  });

  // Eliminar bot
  socket.on('removeBot', ({ code, botId }, callback) => {
    const room = rooms.get(code);

    if (!room || socket.id !== room.hostId) {
      callback({ success: false, error: 'No autorizado' });
      return;
    }

    if (room.removeBot(botId)) {
      io.to(code).emit('roomUpdated', room.getRoomInfo());
      callback({ success: true });
    } else {
      callback({ success: false, error: 'Bot no encontrado' });
    }
  });

  // Actualizar nombre de jugador
  socket.on('updatePlayerName', ({ code, newName }, callback) => {
    const room = rooms.get(code);

    if (!room) {
      if (callback) callback({ success: false, error: 'Sala no encontrada' });
      return;
    }

    if (room.updatePlayerName(socket.id, newName)) {
      io.to(code).emit('roomUpdated', room.getRoomInfo());
      if (callback) callback({ success: true });
    } else {
      if (callback) callback({ success: false, error: 'Error al actualizar nombre' });
    }
  });

  // Actualizar nombre de bot
  socket.on('updateBotName', ({ code, botId, newName }, callback) => {
    const room = rooms.get(code);

    if (!room || socket.id !== room.hostId) {
      if (callback) callback({ success: false, error: 'No autorizado' });
      return;
    }

    if (room.updateBotName(botId, newName)) {
      io.to(code).emit('roomUpdated', room.getRoomInfo());
      if (callback) callback({ success: true });
    } else {
      if (callback) callback({ success: false, error: 'Error al actualizar nombre' });
    }
  });

  // Actualizar configuración
  socket.on('updateConfig', ({ code, config }, callback) => {
    const room = rooms.get(code);

    if (!room || socket.id !== room.hostId) {
      if (callback) callback({ success: false, error: 'No autorizado' });
      return;
    }

    room.updateConfig(config);
    io.to(code).emit('roomUpdated', room.getRoomInfo());
    if (callback) callback({ success: true });
  });

  // Iniciar partida
  socket.on('startGame', ({ code }, callback) => {
    const room = rooms.get(code);

    if (!room || socket.id !== room.hostId) {
      callback({ success: false, error: 'No autorizado' });
      return;
    }

    if (room.startGame()) {
      // Enviar información de revelación a cada jugador
      room.players.forEach((player, playerId) => {
        const wordToSend = room.getWordForPlayer(playerId);
        io.to(playerId).emit('gameStarted', {
          role: player.role,
          specialRole: player.specialRole || null,
          word: wordToSend,
          pista: player.role === 'impostor' && room.config.impostorHasPista ? room.impostorPista : null,
          wordHistory: room.wordHistory,
          roleAbilities: room.roleAbilities.get(playerId) || null
        });
      });

      callback({ success: true });
    } else {
      callback({ success: false, error: 'No se puede iniciar la partida' });
    }
  });

  // Jugador reveló su carta
  socket.on('playerRevealed', ({ code }, callback) => {
    const room = rooms.get(code);

    if (!room) {
      if (callback) callback({ success: false, error: 'Sala no encontrada' });
      return;
    }

    room.playerRevealed(socket.id);

    // Notificar a todos cuántos han revelado
    const totalPlayers = room.players.size;
    const revealedCount = room.playersRevealed.size;

    io.to(code).emit('revealProgress', { revealed: revealedCount, total: totalPlayers });

    // Si todos revelaron, iniciar fase de juego
    if (room.allPlayersRevealed()) {
      room.startPlayingPhase();

      const currentPlayer = room.getCurrentPlayer();
      io.to(code).emit('playingPhaseStarted', {
        currentPlayer: {
          id: currentPlayer.id,
          name: currentPlayer.name,
          isBot: currentPlayer.isBot
        }
      });

      // Si el primer jugador es un bot, procesar automáticamente
      if (currentPlayer.isBot) {
        processBotTurn(room, code);
      }
    }

    if (callback) callback({ success: true });
  });

  // Enviar palabra
  socket.on('submitWord', async ({ code, word }, callback) => {
    const room = rooms.get(code);

    if (!room) {
      if (callback) callback({ success: false, error: 'Sala no encontrada' });
      return;
    }

    if (room.submitWord(socket.id, word)) {
      // Notificar a todos la palabra enviada
      const currentPlayer = room.getAllPlayers().find(p => p.id === socket.id);
      io.to(code).emit('wordSubmitted', {
        playerId: socket.id,
        playerName: currentPlayer.name,
        word: word
      });

      if (callback) callback({ success: true });

      // Esperar tiempo configurado antes de continuar
      const wordDelay = (room.config.wordDelay || 15) * 1000;
      setTimeout(async () => {
        if (room.allWordsSubmitted()) {
          // Iniciar votación
          room.startVoting();
          io.to(code).emit('votingStarted', {
            players: room.getAlivePlayers().map(p => ({
              id: p.id,
              name: p.name,
              isBot: p.isBot
            }))
          });

          // Procesar votos de bots
          await processBotVotes(room, code);
        } else {
          // Siguiente jugador
          const nextPlayer = room.getCurrentPlayer();
          io.to(code).emit('nextPlayer', {
            currentPlayer: {
              id: nextPlayer.id,
              name: nextPlayer.name,
              isBot: nextPlayer.isBot
            }
          });

          // Si es un bot, procesar automáticamente
          if (nextPlayer.isBot) {
            processBotTurn(room, code);
          }
        }
      }, wordDelay);
    } else {
      if (callback) callback({ success: false, error: 'No es tu turno' });
    }
  });

  // Votar
  socket.on('submitVote', async ({ code, votedPlayerId }, callback) => {
    const room = rooms.get(code);

    if (!room) {
      if (callback) callback({ success: false, error: 'Sala no encontrada' });
      return;
    }

    if (room.submitVote(socket.id, votedPlayerId)) {
      // Notificar progreso de votación
      const alivePlayers = room.getAlivePlayers();
      const votedCount = room.votes.size;

      io.to(code).emit('voteProgress', { voted: votedCount, total: alivePlayers.length });

      // Enviar conteo de votos actualizado
      const voteCounts = room.countVotes();
      const voteCountsObj = Object.fromEntries(voteCounts);
      io.to(code).emit('voteCountsUpdated', voteCountsObj);

      if (callback) callback({ success: true });

      // Si todos votaron, procesar resultados
      if (room.allVotesCast()) {
        processVoteResults(room, code);
      }
    } else {
      if (callback) callback({ success: false, error: 'Error al votar' });
    }
  });

  // Habilidades de roles

  // Detective: Interrogar jugador
  socket.on('interrogatePlayer', ({ code, targetId }, callback) => {
    const room = rooms.get(code);

    if (!room) {
      if (callback) callback({ success: false, error: 'Sala no encontrada' });
      return;
    }

    const result = room.interrogatePlayer(socket.id, targetId);

    if (result.success) {
      // Enviar resultado al detective
      if (callback) callback(result);

      // Notificar a todos que el detective interrogó (sin revelar resultado)
      const detective = room.getAllPlayers().find(p => p.id === socket.id);
      io.to(code).emit('roleNotification', {
        type: 'detective',
        message: `🔍 ${detective?.name || 'Detective'} ha interrogado a ${result.targetName}`,
        style: 'blue'
      });
    } else {
      if (callback) callback(result);
    }
  });

  // Médico: Quitar voto
  socket.on('removeVote', ({ code, targetId }, callback) => {
    const room = rooms.get(code);

    if (!room) {
      if (callback) callback({ success: false, error: 'Sala no encontrada' });
      return;
    }

    const result = room.removeVote(socket.id, targetId);

    if (result.success) {
      // Enviar resultado al médico
      if (callback) callback(result);

      // Actualizar conteo de votos para todos
      const voteCounts = room.countVotes();
      const voteCountsObj = Object.fromEntries(voteCounts);
      io.to(code).emit('voteCountsUpdated', voteCountsObj);

      // Notificar a todos que el médico usó su habilidad
      const medic = room.getAllPlayers().find(p => p.id === socket.id);
      io.to(code).emit('roleNotification', {
        type: 'medic',
        message: `💊 ${medic?.name || 'Médico'} ha quitado 1 voto de ${result.targetName}`,
        style: 'green'
      });
    } else {
      if (callback) callback(result);
    }
  });

  // Escritor: Usar habilidad de cambiar palabra
  socket.on('useWriterAbility', ({ code, targetId, fakeWord }, callback) => {
    const room = rooms.get(code);

    if (!room) {
      if (callback) callback({ success: false, error: 'Sala no encontrada' });
      return;
    }

    const result = room.useWriterAbility(socket.id, targetId, fakeWord);

    if (result.success) {
      if (callback) callback(result);

      if (result.swapped) {
        // Notificar al objetivo que su palabra fue cambiada
        io.to(result.targetId).emit('wordSwapped', {
          newWord: fakeWord,
          message: '¡Alguien ha cambiado tu palabra!',
          hint: 'Puede que alguien esté intentando confundirte... 🤔'
        });

        // Notificar a todos que un escritor usó su habilidad
        io.to(code).emit('roleNotification', {
          type: 'writer',
          message: '✍️ Un impostor ha cambiado la palabra de alguien ¡CUIDADO!',
          style: 'red'
        });
      }
    } else {
      if (callback) callback(result);
    }
  });

  // Desconexión
  socket.on('disconnect', () => {
    console.log('Cliente desconectado:', socket.id);

    // Buscar y eliminar jugador de su sala
    for (const [code, room] of rooms.entries()) {
      if (room.players.has(socket.id)) {
        room.removePlayer(socket.id);

        // Si no quedan jugadores, eliminar sala
        if (room.players.size === 0) {
          rooms.delete(code);
        } else {
          io.to(code).emit('roomUpdated', room.getRoomInfo());
        }
        break;
      }
    }
  });
});

// Función auxiliar para procesar turno de bot
async function processBotTurn(room, code) {
  const currentBot = room.getCurrentPlayer();

  if (!currentBot || !currentBot.isBot) return;

  // Si es el primer turno de la ronda y el bot es escritor, usar habilidad
  if (room.currentPlayerIndex === 0 && currentBot.specialRole === 'writer') {
    const abilities = room.roleAbilities.get(currentBot.id);
    if (abilities && !abilities.usedThisRound) {
      await new Promise(resolve => setTimeout(resolve, 2000));

      const writerAction = currentBot.ai.shouldUseWriterAbility(room.getAllPlayers());
      if (writerAction) {
        const result = room.useWriterAbility(currentBot.id, writerAction.targetId, writerAction.fakeWord);
        if (result.success && result.swapped) {
          // Notificar al objetivo
          io.to(result.targetId).emit('wordSwapped', {
            newWord: writerAction.fakeWord,
            message: '¡Alguien ha cambiado tu palabra!',
            hint: 'Puede que alguien esté intentando confundirte... 🤔'
          });

          // Notificar a todos
          io.to(code).emit('roleNotification', {
            type: 'writer',
            message: `✍️ Un impostor ha cambiado la palabra de alguien ¡CUIDADO!`,
            style: 'red'
          });
        }
      }
    }
  }

  // Notificar que el bot está pensando
  io.to(code).emit('botThinking', {
    botId: currentBot.id,
    botName: currentBot.name
  });

  // Esperar 3-5 segundos (simular pensamiento)
  const thinkTime = 3000 + Math.random() * 2000;

  setTimeout(async () => {
    const botWord = await room.getBotWord(currentBot);
    room.submitWord(currentBot.id, botWord);

    // Notificar palabra del bot
    io.to(code).emit('wordSubmitted', {
      playerId: currentBot.id,
      playerName: currentBot.name,
      word: botWord
    });

    // Si el bot es detective, considerar interrogar
    if (currentBot.specialRole === 'detective') {
      const abilities = room.roleAbilities.get(currentBot.id);
      if (abilities) {
        await new Promise(resolve => setTimeout(resolve, 1500));

        const targetId = currentBot.ai.shouldInterrogate(room.getAllPlayers(), abilities.interrogated);
        if (targetId) {
          const result = room.interrogatePlayer(currentBot.id, targetId);
          if (result.success) {
            // Notificar a todos que el detective interrogó
            io.to(code).emit('roleNotification', {
              type: 'detective',
              message: `🔍 ${currentBot.name} ha interrogado a ${result.targetName}`,
              style: 'blue'
            });
          }
        }
      }
    }

    // Esperar tiempo configurado antes de continuar
    const wordDelay = (room.config.wordDelay || 15) * 1000;
    setTimeout(async () => {
      if (room.allWordsSubmitted()) {
        room.startVoting();
        io.to(code).emit('votingStarted', {
          players: room.getAlivePlayers().map(p => ({
            id: p.id,
            name: p.name,
            isBot: p.isBot
          }))
        });

        await processBotVotes(room, code);
      } else {
        const nextPlayer = room.getCurrentPlayer();
        io.to(code).emit('nextPlayer', {
          currentPlayer: {
            id: nextPlayer.id,
            name: nextPlayer.name,
            isBot: nextPlayer.isBot
          }
        });

        if (nextPlayer.isBot) {
          processBotTurn(room, code);
        }
      }
    }, wordDelay);
  }, thinkTime);
}

// Función auxiliar para procesar votos de bots
async function processBotVotes(room, code) {
  const aliveBots = room.bots.filter(b => !room.eliminatedPlayers.has(b.id));

  for (const bot of aliveBots) {
    // Esperar un poco antes de que cada bot vote (para parecer natural)
    await new Promise(resolve => setTimeout(resolve, 2000 + Math.random() * 3000));

    const botVote = await room.getBotVote(bot);
    room.submitVote(bot.id, botVote);

    // Notificar progreso
    const alivePlayers = room.getAlivePlayers();
    const votedCount = room.votes.size;
    io.to(code).emit('voteProgress', { voted: votedCount, total: alivePlayers.length });

    // Enviar conteo de votos actualizado
    const voteCounts = room.countVotes();
    const voteCountsObj = Object.fromEntries(voteCounts);
    io.to(code).emit('voteCountsUpdated', voteCountsObj);

    // Si el bot es médico, considerar usar su habilidad
    if (bot.specialRole === 'medic') {
      const abilities = room.roleAbilities.get(bot.id);
      if (abilities && !abilities.abilityUsed) {
        await new Promise(resolve => setTimeout(resolve, 1500));

        const targetId = bot.ai.shouldUseMedicAbility(voteCounts, alivePlayers);
        if (targetId) {
          const result = room.removeVote(bot.id, targetId);
          if (result.success) {
            // Notificar que el médico bot usó su habilidad
            io.to(code).emit('roleNotification', {
              type: 'medic',
              message: `💊 ${bot.name} ha quitado 1 voto de ${result.targetName}`,
              style: 'green'
            });

            // Actualizar conteos de votos
            const updatedCounts = room.countVotes();
            const updatedCountsObj = Object.fromEntries(updatedCounts);
            io.to(code).emit('voteCountsUpdated', updatedCountsObj);
          }
        }
      }
    }
  }

  // Si todos ya votaron (incluyendo humanos), procesar resultados
  if (room.allVotesCast()) {
    processVoteResults(room, code);
  }
}

// Función auxiliar para procesar resultados de votación
function processVoteResults(room, code) {
  const result = room.eliminatePlayer();

  if (result.tied) {
    // Empate - desempate
    io.to(code).emit('voteTied', {
      tiedPlayers: result.tied.map(id => {
        const player = room.getAllPlayers().find(p => p.id === id);
        return { id, name: player.name };
      })
    });

    // Reiniciar para desempate con los jugadores empatados
    room.resetForTiebreaker(result.tied);

    const voteDelay = (room.config.voteDelay || 5) * 1000;
    setTimeout(() => {
      const currentPlayer = room.getCurrentPlayer();

      io.to(code).emit('tiebreakerStarted', {
        players: result.tied.map(id => {
          const player = room.getAllPlayers().find(p => p.id === id);
          return { id, name: player.name, isBot: player.isBot };
        })
      });

      // Iniciar el turno del primer jugador en el desempate
      io.to(code).emit('nextPlayer', {
        currentPlayer: {
          id: currentPlayer.id,
          name: currentPlayer.name,
          isBot: currentPlayer.isBot
        }
      });

      // Si el primer jugador es un bot, procesar su turno
      if (currentPlayer.isBot) {
        processBotTurn(room, code);
      }
    }, voteDelay);
  } else {
    // Jugador eliminado
    const eliminatedPlayer = room.getAllPlayers().find(p => p.id === result.eliminated);

    io.to(code).emit('playerEliminated', {
      playerId: result.eliminated,
      playerName: eliminatedPlayer.name,
      role: eliminatedPlayer.role,
      votes: room.countVotes()
    });

    // Verificar condición de victoria
    const winner = room.checkWinCondition();

    const voteDelay = (room.config.voteDelay || 5) * 1000;
    setTimeout(() => {
      if (winner) {
        const allPlayers = room.getAllPlayers().map(p => ({
          id: p.id,
          name: p.name,
          role: p.role
        }));

        io.to(code).emit('gameFinished', {
          winner: winner,
          word: room.currentWord,
          players: allPlayers
        });

        room.gameState = 'finished';
      } else {
        // Continuar con nueva ronda
        room.startNewRound();
        const currentPlayer = room.getCurrentPlayer();

        io.to(code).emit('newRound', {
          roundNumber: room.roundNumber,
          currentPlayer: {
            id: currentPlayer.id,
            name: currentPlayer.name,
            isBot: currentPlayer.isBot
          }
        });

        if (currentPlayer.isBot) {
          processBotTurn(room, code);
        }
      }
    }, voteDelay);
  } 
}

// Endpoint raíz
app.get('/', (req, res) => {
  res.json({
    message: 'Impostor Online - Backend API',
    status: 'online',
    rooms: rooms.size,
    endpoints: {
      health: '/health',
      socket: 'Socket.IO en la misma URL'
    }
  });
});

// Endpoint de health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', rooms: rooms.size });
});

server.listen(PORT, () => {
  console.log(`Servidor corriendo en puerto ${PORT}`);
});
