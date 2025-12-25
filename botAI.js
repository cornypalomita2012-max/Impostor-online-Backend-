class BotAI {
  constructor(botId) {
    this.botId = botId;
    this.role = null;
    this.word = null;
    this.pista = null;
    this.allPlayers = [];
    this.observedWords = new Map(); // Map de playerId -> word
    this.suspicionScores = new Map(); // Map de playerId -> score (0-100)
  }

  initialize(role, word, pista, allPlayers) {
    this.role = role;
    this.word = word;
    this.pista = pista;
    this.allPlayers = allPlayers;

    // Inicializar scores de sospecha
    allPlayers.forEach(player => {
      if (player.id !== this.botId) {
        this.suspicionScores.set(player.id, 50); // Neutral al principio
      }
    });
  }

  observeWord(playerId, word, playerName) {
    if (playerId === this.botId) return;

    this.observedWords.set(playerId, { word, playerName });
    this.updateSuspicion(playerId, word);
  }

  updateSuspicion(playerId, word) {
    // Analizar si la palabra es sospechosa
    const allWords = Array.from(this.observedWords.values()).map(w => w.word);
    let suspicion = this.suspicionScores.get(playerId) || 50;

    if (this.role === 'civil') {
      // Como civil, buscar palabras que no se relacionen con la palabra real
      const similarity = this.calculateWordSimilarity(word, this.word);

      if (similarity < 0.3) {
        // Palabra muy diferente - probablemente impostor
        suspicion += 20;
      } else if (similarity > 0.7) {
        // Palabra muy similar - probablemente civil
        suspicion -= 15;
      }

      // Si la palabra es genérica o muy vaga
      if (this.isVagueWord(word)) {
        suspicion += 10;
      }

      // Si la palabra contradice otras palabras civiles
      const civilWords = Array.from(this.observedWords.values())
        .filter((_, id) => this.suspicionScores.get(id) < 50)
        .map(w => w.word);

      if (civilWords.length > 0) {
        const avgSimilarity = civilWords.reduce((sum, w) =>
          sum + this.calculateWordSimilarity(word, w), 0) / civilWords.length;

        if (avgSimilarity < 0.3) {
          suspicion += 15;
        }
      }
    } else {
      // Como impostor, buscar otros impostores (palabras genéricas o incongruentes)
      const similarity = this.calculateWordSimilarityToPista(word);

      if (similarity < 0.3 && this.isVagueWord(word)) {
        // Probablemente otro impostor
        suspicion += 25;
      } else if (similarity > 0.6) {
        // Probablemente civil
        suspicion -= 20;
      }

      // Buscar patrones en las palabras
      const wordPattern = this.analyzeWordPattern(word, allWords);
      if (wordPattern === 'outlier') {
        suspicion += 15;
      }
    }

    // Normalizar entre 0 y 100
    suspicion = Math.max(0, Math.min(100, suspicion));
    this.suspicionScores.set(playerId, suspicion);
  }

  calculateWordSimilarity(word1, word2) {
    if (!word1 || !word2) return 0;

    word1 = word1.toLowerCase().trim();
    word2 = word2.toLowerCase().trim();

    // Similitud exacta
    if (word1 === word2) return 1.0;

    // Relaciones semánticas simples (expandir según necesidad)
    const semanticGroups = [
      ['perro', 'gato', 'mascota', 'animal', 'peludo', 'cuatro patas'],
      ['pizza', 'pasta', 'italiano', 'comida', 'queso', 'horno'],
      ['playa', 'mar', 'arena', 'olas', 'verano', 'sol', 'costa'],
      ['montaña', 'pico', 'altura', 'nieve', 'alpinismo', 'cima'],
      ['coche', 'auto', 'vehículo', 'ruedas', 'motor', 'conducir'],
      ['avión', 'volar', 'cielo', 'aeropuerto', 'alas', 'piloto'],
      ['libro', 'leer', 'páginas', 'historia', 'autor', 'novela'],
      ['música', 'sonido', 'canción', 'melodía', 'notas', 'ritmo'],
      ['fútbol', 'balón', 'deporte', 'gol', 'equipo', 'estadio'],
      ['ordenador', 'computadora', 'teclado', 'pantalla', 'tecnología', 'software'],
      ['café', 'cafeína', 'taza', 'bebida', 'negro', 'despertar'],
      ['chocolate', 'cacao', 'dulce', 'postre', 'marrón', 'tableta'],
      ['luna', 'noche', 'satélite', 'cráteres', 'brillo', 'llena'],
      ['sol', 'estrella', 'luz', 'calor', 'día', 'amarillo'],
      ['árbol', 'tronco', 'hojas', 'ramas', 'bosque', 'madera'],
      ['flor', 'petalo', 'jardín', 'aroma', 'colores', 'primavera'],
      ['río', 'agua', 'corriente', 'cauce', 'peces', 'puente'],
      ['ciudad', 'urbano', 'edificios', 'calles', 'gente', 'tráfico'],
      ['casa', 'hogar', 'vivienda', 'techo', 'habitaciones', 'familia'],
      ['invierno', 'frío', 'nieve', 'diciembre', 'bufanda', 'hielo'],
      ['verano', 'calor', 'vacaciones', 'playa', 'julio', 'sol'],
      ['primavera', 'flores', 'abril', 'renacimiento', 'colores', 'polen'],
      ['otoño', 'hojas', 'octubre', 'viento', 'cosecha', 'marrón']
    ];

    // Buscar en qué grupo está cada palabra
    let group1 = -1;
    let group2 = -1;

    for (let i = 0; i < semanticGroups.length; i++) {
      if (semanticGroups[i].some(w => word1.includes(w) || w.includes(word1))) {
        group1 = i;
      }
      if (semanticGroups[i].some(w => word2.includes(w) || w.includes(word2))) {
        group2 = i;
      }
    }

    // Si están en el mismo grupo semántico
    if (group1 !== -1 && group1 === group2) {
      return 0.8;
    }

    // Similitud por Levenshtein (simplificada)
    const distance = this.levenshteinDistance(word1, word2);
    const maxLength = Math.max(word1.length, word2.length);
    const similarity = 1 - (distance / maxLength);

    return Math.max(0, similarity);
  }

  calculateWordSimilarityToPista(word) {
    if (!this.pista || !word) return 0;

    const pista = this.pista.toLowerCase();
    const w = word.toLowerCase();

    // Palabras clave en la pista
    const pistaKeywords = pista.split(' ');

    // Verificar si la palabra contiene o se relaciona con la pista
    for (const keyword of pistaKeywords) {
      if (w.includes(keyword) || keyword.includes(w)) {
        return 0.8;
      }
    }

    // Relaciones de la pista con categorías
    const pistaRelations = {
      'animal': ['perro', 'gato', 'mascota', 'peludo', 'patas', 'cola'],
      'comida': ['pizza', 'pasta', 'comer', 'sabor', 'plato', 'cocina'],
      'lugar': ['playa', 'montaña', 'ciudad', 'parque', 'sitio'],
      'vehículo': ['coche', 'auto', 'ruedas', 'motor', 'conducir'],
      'tecnología': ['ordenador', 'computadora', 'digital', 'electrónico'],
      'bebida': ['café', 'taza', 'líquido', 'beber'],
      'dulce': ['chocolate', 'azúcar', 'postre', 'golosina'],
      'astro': ['luna', 'sol', 'estrella', 'espacio', 'cielo'],
      'planta': ['árbol', 'flor', 'verde', 'hoja', 'raíz'],
      'agua': ['río', 'mar', 'océano', 'lago', 'líquido'],
      'edificio': ['casa', 'escuela', 'hospital', 'construcción'],
      'estación': ['invierno', 'verano', 'primavera', 'otoño', 'año'],
      'clima': ['lluvia', 'nieve', 'sol', 'viento', 'tiempo']
    };

    for (const [category, words] of Object.entries(pistaRelations)) {
      if (pista.includes(category)) {
        if (words.some(keyword => w.includes(keyword) || keyword.includes(w))) {
          return 0.7;
        }
      }
    }

    return 0.3;
  }

  isVagueWord(word) {
    const vagueWords = [
      'cosa', 'algo', 'objeto', 'elemento', 'item', 'eso',
      'esto', 'aquello', 'entidad', 'concepto', 'idea',
      'bueno', 'malo', 'grande', 'pequeño', 'rojo', 'azul'
    ];

    const w = word.toLowerCase().trim();
    return vagueWords.some(vague => w.includes(vague) || w.length < 4);
  }

  analyzeWordPattern(word, allWords) {
    // Analizar si la palabra es un outlier comparado con otras
    const similarities = allWords
      .filter(w => w !== word)
      .map(w => this.calculateWordSimilarity(word, w));

    if (similarities.length === 0) return 'normal';

    const avgSimilarity = similarities.reduce((a, b) => a + b, 0) / similarities.length;

    if (avgSimilarity < 0.3) return 'outlier';
    if (avgSimilarity > 0.7) return 'conforming';
    return 'normal';
  }

  levenshteinDistance(str1, str2) {
    const matrix = [];

    for (let i = 0; i <= str2.length; i++) {
      matrix[i] = [i];
    }

    for (let j = 0; j <= str1.length; j++) {
      matrix[0][j] = j;
    }

    for (let i = 1; i <= str2.length; i++) {
      for (let j = 1; j <= str1.length; j++) {
        if (str2.charAt(i - 1) === str1.charAt(j - 1)) {
          matrix[i][j] = matrix[i - 1][j - 1];
        } else {
          matrix[i][j] = Math.min(
            matrix[i - 1][j - 1] + 1,
            matrix[i][j - 1] + 1,
            matrix[i - 1][j] + 1
          );
        }
      }
    }

    return matrix[str2.length][str1.length];
  }

  async generateWord(allWords) {
    // Esperar un poco (simular pensamiento)
    await new Promise(resolve => setTimeout(resolve, 500));

    if (this.role === 'civil') {
      // Como civil, generar palabra relacionada con la palabra real
      return this.generateCivilWord(allWords);
    } else {
      // Como impostor, generar palabra basada en pista u observaciones
      return this.generateImpostorWord(allWords);
    }
  }

  generateCivilWord(allWords) {
    // Palabras relacionadas por tema
    const relatedWords = {
      'Perro': ['Mascota', 'Ladrar', 'Peludo', 'Fiel', 'Hueso', 'Collar'],
      'Gato': ['Mascota', 'Maullar', 'Felino', 'Bigotes', 'Garras', 'Independiente'],
      'Pizza': ['Italiano', 'Queso', 'Horno', 'Masa', 'Salsa', 'Rebanada'],
      'Playa': ['Arena', 'Mar', 'Olas', 'Toalla', 'Sombrilla', 'Verano'],
      'Montaña': ['Pico', 'Escalada', 'Altura', 'Nieve', 'Cumbre', 'Rocas'],
      'Coche': ['Motor', 'Ruedas', 'Conducir', 'Gasolina', 'Volante', 'Frenos'],
      'Avión': ['Volar', 'Alas', 'Piloto', 'Aeropuerto', 'Despegar', 'Nubes'],
      'Libro': ['Leer', 'Páginas', 'Autor', 'Historia', 'Biblioteca', 'Capítulos'],
      'Música': ['Canción', 'Melodía', 'Ritmo', 'Instrumento', 'Notas', 'Concierto'],
      'Fútbol': ['Balón', 'Gol', 'Equipo', 'Estadio', 'Árbitro', 'Mundial'],
      'Ordenador': ['Teclado', 'Pantalla', 'Ratón', 'Software', 'Internet', 'Datos'],
      'Café': ['Cafeína', 'Taza', 'Mañana', 'Despertar', 'Negro', 'Aromático'],
      'Chocolate': ['Cacao', 'Dulce', 'Tableta', 'Marrón', 'Postre', 'Derretir'],
      'Luna': ['Noche', 'Cráteres', 'Satélite', 'Llena', 'Brillo', 'Astronauta'],
      'Sol': ['Estrella', 'Luz', 'Calor', 'Día', 'Rayos', 'Brillante'],
      'Árbol': ['Tronco', 'Hojas', 'Ramas', 'Bosque', 'Madera', 'Raíces'],
      'Flor': ['Pétalos', 'Aroma', 'Jardín', 'Colores', 'Polen', 'Belleza'],
      'Río': ['Corriente', 'Agua', 'Cauce', 'Peces', 'Puente', 'Orilla'],
      'Mar': ['Océano', 'Sal', 'Profundo', 'Olas', 'Azul', 'Barco'],
      'Ciudad': ['Edificios', 'Calles', 'Tráfico', 'Urbano', 'Plaza', 'Gente'],
      'Casa': ['Hogar', 'Techo', 'Habitaciones', 'Familia', 'Puerta', 'Ventanas'],
      'Escuela': ['Aulas', 'Estudiantes', 'Maestro', 'Aprender', 'Libros', 'Recreo'],
      'Hospital': ['Médicos', 'Enfermeras', 'Salud', 'Emergencia', 'Camas', 'Curas'],
      'Parque': ['Verde', 'Bancos', 'Juegos', 'Naturaleza', 'Paseo', 'Árboles'],
      'Cine': ['Películas', 'Pantalla', 'Palomitas', 'Butacas', 'Oscuro', 'Estreno'],
      'Restaurante': ['Comida', 'Menú', 'Camarero', 'Mesa', 'Platos', 'Comer'],
      'Invierno': ['Frío', 'Nieve', 'Bufanda', 'Hielo', 'Navidad', 'Diciembre'],
      'Verano': ['Calor', 'Vacaciones', 'Playa', 'Sol', 'Julio', 'Descanso'],
      'Primavera': ['Flores', 'Renacimiento', 'Colores', 'Abril', 'Polen', 'Alegre'],
      'Otoño': ['Hojas', 'Caída', 'Viento', 'Octubre', 'Cosecha', 'Marrón'],
      'Lluvia': ['Gotas', 'Paraguas', 'Mojado', 'Nubes', 'Charcos', 'Truenos'],
      'Nieve': ['Blanco', 'Frío', 'Copos', 'Invierno', 'Esquí', 'Hielo']
    };

    const possibleWords = relatedWords[this.word] || ['Relacionado', 'Similar', 'Parecido'];

    // Evitar palabras ya usadas
    const usedWords = allWords.map(w => w.word.toLowerCase());
    const availableWords = possibleWords.filter(w => !usedWords.includes(w.toLowerCase()));

    if (availableWords.length > 0) {
      return availableWords[Math.floor(Math.random() * availableWords.length)];
    }

    // Si todas están usadas, generar una variante
    return possibleWords[Math.floor(Math.random() * possibleWords.length)];
  }

  generateImpostorWord(allWords) {
    if (this.pista && this.config?.impostorHasPista !== false) {
      // Usar pista para generar palabra
      return this.generateWordFromPista(allWords);
    } else {
      // Analizar palabras de otros y tratar de encajar
      return this.generateWordFromObservations(allWords);
    }
  }

  generateWordFromPista(allWords) {
    const pistaLower = this.pista.toLowerCase();

    // Palabras genéricas por categoría de pista
    const pistaWords = {
      'animal': ['Criatura', 'Ser vivo', 'Fauna', 'Especie', 'Ejemplar'],
      'comida': ['Plato', 'Alimento', 'Delicioso', 'Sabor', 'Comer'],
      'lugar': ['Sitio', 'Espacio', 'Zona', 'Área', 'Destino'],
      'vehículo': ['Transporte', 'Viajar', 'Moverse', 'Velocidad', 'Conducir'],
      'tecnología': ['Digital', 'Electrónico', 'Moderno', 'Avanzado', 'Dispositivo'],
      'bebida': ['Líquido', 'Tomar', 'Refrescante', 'Vaso', 'Sorbo'],
      'dulce': ['Azúcar', 'Postre', 'Sabroso', 'Golosina', 'Delicia'],
      'astro': ['Celeste', 'Cielo', 'Espacio', 'Brillo', 'Cósmico'],
      'planta': ['Verde', 'Naturaleza', 'Crecer', 'Vegetal', 'Orgánico'],
      'agua': ['Líquido', 'Húmedo', 'Fluir', 'Corriente', 'Transparente'],
      'edificio': ['Estructura', 'Construcción', 'Lugar', 'Espacio', 'Interior'],
      'estación': ['Temporada', 'Época', 'Año', 'Clima', 'Cambio'],
      'clima': ['Tiempo', 'Atmósfera', 'Meteorológico', 'Condición', 'Ambiente']
    };

    // Buscar palabras para la pista
    for (const [category, words] of Object.entries(pistaWords)) {
      if (pistaLower.includes(category)) {
        const usedWords = allWords.map(w => w.word.toLowerCase());
        const availableWords = words.filter(w => !usedWords.includes(w.toLowerCase()));

        if (availableWords.length > 0) {
          return availableWords[Math.floor(Math.random() * availableWords.length)];
        }
      }
    }

    // Palabra genérica de respaldo
    const genericWords = ['Cosa', 'Elemento', 'Objeto', 'Algo', 'Eso', 'Item'];
    return genericWords[Math.floor(Math.random() * genericWords.length)];
  }

  generateWordFromObservations(allWords) {
    if (allWords.length === 0) {
      return 'Algo';
    }

    // Analizar las palabras más comunes/frecuentes
    const wordThemes = this.extractThemes(allWords);

    if (wordThemes.length > 0) {
      // Generar palabra genérica relacionada con el tema dominante
      const theme = wordThemes[0];
      const themeWords = {
        'animal': ['Criatura', 'Ser', 'Ejemplar'],
        'comida': ['Alimento', 'Plato', 'Sabor'],
        'lugar': ['Sitio', 'Espacio', 'Zona'],
        'objeto': ['Cosa', 'Elemento', 'Item']
      };

      const words = themeWords[theme] || ['Algo', 'Eso', 'Relacionado'];
      return words[Math.floor(Math.random() * words.length)];
    }

    // Respaldo: palabra muy genérica
    const veryGeneric = ['Algo', 'Cosa', 'Eso', 'Elemento', 'Item', 'Objeto'];
    return veryGeneric[Math.floor(Math.random() * veryGeneric.length)];
  }

  extractThemes(allWords) {
    const themes = {
      animal: 0,
      comida: 0,
      lugar: 0,
      objeto: 0
    };

    const keywords = {
      animal: ['mascota', 'peludo', 'patas', 'cola', 'ladrar', 'maullar', 'animal'],
      comida: ['comer', 'sabor', 'plato', 'cocina', 'delicioso', 'comida', 'alimento'],
      lugar: ['ir', 'visitar', 'estar', 'sitio', 'espacio', 'zona', 'lugar'],
      objeto: ['usar', 'tener', 'objeto', 'cosa', 'item', 'elemento']
    };

    allWords.forEach(({ word }) => {
      const w = word.toLowerCase();
      for (const [theme, words] of Object.entries(keywords)) {
        if (words.some(keyword => w.includes(keyword))) {
          themes[theme]++;
        }
      }
    });

    return Object.entries(themes)
      .sort((a, b) => b[1] - a[1])
      .map(([theme]) => theme);
  }

  async vote(allWords, existingVotes) {
    // Esperar un poco (simular decisión)
    await new Promise(resolve => setTimeout(resolve, 500));

    // Obtener todos los candidatos ordenados por sospecha (SIN filtrar por votos existentes)
    const candidates = Array.from(this.suspicionScores.entries())
      .sort((a, b) => b[1] - a[1]); // Ordenar por mayor sospecha

    if (candidates.length === 0) {
      return null;
    }

    // Lógica de votación más natural
    const topSuspect = candidates[0];
    const secondSuspect = candidates[1];
    const thirdSuspect = candidates[2];

    // 70% de probabilidad de votar al más sospechoso
    if (Math.random() < 0.7) {
      return topSuspect[0];
    }

    // 20% de probabilidad de votar al segundo más sospechoso (si existe)
    if (secondSuspect && Math.random() < 0.66) { // 0.66 de 0.3 = ~0.2 total
      return secondSuspect[0];
    }

    // 10% de probabilidad de votar al tercero (si existe) o random
    if (thirdSuspect) {
      return thirdSuspect[0];
    }

    // Fallback: votar al más sospechoso
    return topSuspect[0];
  }
}

module.exports = BotAI;
