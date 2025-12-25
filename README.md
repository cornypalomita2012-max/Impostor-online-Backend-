# Impostor Online - Backend

Backend del juego Impostor Online con Socket.IO y Node.js.

## 🚀 Instalación

```bash
npm install
```

## ▶️ Ejecutar

```bash
npm start
```

El servidor se iniciará en `http://localhost:3001`

## 📦 Dependencias

- **express**: Servidor HTTP
- **socket.io**: Comunicación en tiempo real
- **cors**: Permitir peticiones cross-origin
- **uuid**: Generar IDs únicos para salas

## 🏗️ Estructura

```
backend/
├── server.js       # Servidor principal y lógica del juego
├── botAI.js        # Algoritmo de IA para los bots
├── package.json    # Dependencias
└── .gitignore      # Archivos ignorados por Git
```

## 🌐 Desplegar en Producción

### Railway (Gratis)

1. Ve a [railway.app](https://railway.app)
2. Conecta este repositorio
3. Railway detectará automáticamente Node.js
4. Deployment automático

### Render (Gratis)

1. Ve a [render.com](https://render.com)
2. New → Web Service
3. Conecta el repositorio
4. Build Command: `npm install`
5. Start Command: `npm start`

### Variables de Entorno (Opcional)

```env
PORT=3001
```

## 📝 API Socket.IO

### Eventos del Cliente → Servidor

- `createRoom` - Crear una sala
- `listRooms` - Listar salas disponibles
- `joinRoom` - Unirse a una sala
- `addBot` - Añadir un bot
- `removeBot` - Eliminar un bot
- `updateConfig` - Actualizar configuración
- `startGame` - Iniciar partida
- `playerRevealed` - Jugador reveló su carta
- `submitWord` - Enviar palabra
- `submitVote` - Enviar voto

### Eventos del Servidor → Cliente

- `roomUpdated` - Sala actualizada
- `gameStarted` - Juego iniciado
- `revealProgress` - Progreso de revelación
- `playingPhaseStarted` - Fase de juego iniciada
- `wordSubmitted` - Palabra enviada
- `nextPlayer` - Siguiente jugador
- `votingStarted` - Votación iniciada
- `voteProgress` - Progreso de votación
- `playerEliminated` - Jugador eliminado
- `voteTied` - Empate en votación
- `tiebreakerStarted` - Desempate iniciado
- `newRound` - Nueva ronda
- `gameFinished` - Juego terminado

## 🤖 Sistema de IA

Los bots usan análisis semántico para:

- Generar palabras coherentes según su rol
- Analizar palabras de otros jugadores
- Calcular scores de sospecha (0-100)
- Votar inteligentemente con probabilidades:
  - 70% voto al más sospechoso
  - 20% voto al segundo
  - 10% voto variado

## 📄 Licencia

Open Source - Libre uso y modificación
