import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import Database from 'better-sqlite3';

const app = express();
const server = createServer(app);
const io = new Server(server);
const db = new Database('world.db');

app.use(express.static('public'));

// Database setup
db.exec(`
  CREATE TABLE IF NOT EXISTS players (
    id TEXT PRIMARY KEY, name TEXT, x INT DEFAULT 25, y INT DEFAULT 25,
    hp INT DEFAULT 100, maxhp INT DEFAULT 100, inv TEXT DEFAULT '[]', level INT DEFAULT 1
  );
  CREATE TABLE IF NOT EXISTS world (
    x INT, y INT, terrain TEXT DEFAULT 'grass', building TEXT, items TEXT DEFAULT '[]',
    PRIMARY KEY (x, y)
  );
  CREATE TABLE IF NOT EXISTS npcs (
    id INT PRIMARY KEY, name TEXT, x INT, y INT, quest TEXT, dialog TEXT
  );
`);

// Generate world 50x50
const insertTile = db.prepare('INSERT OR IGNORE INTO world (x, y, terrain) VALUES (?, ?, ?)');
const genWorld = db.transaction(() => {
  for (let x = 0; x < 50; x++) {
    for (let y = 0; y < 50; y++) {
      let terrain = 'grass';
      if (Math.random() > 0.8) terrain = 'forest';
      if (Math.random() > 0.95) terrain = 'mountain';
      insertTile.run(x, y, terrain);
    }
  }
});
genWorld();

// Spawn NPCs
db.prepare('INSERT OR IGNORE INTO npcs VALUES (?, ?, ?, ?, ?, ?)').run(
  1, 'Старик', 10, 10, 'wood:5', 'Собери 5 дерева для меня!'
);

const players = new Map();

// Helper functions
const getPlayer = db.prepare('SELECT * FROM players WHERE id = ?');
const savePlayer = db.prepare(
  'INSERT OR REPLACE INTO players VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
);
const getTile = db.prepare('SELECT * FROM world WHERE x = ? AND y = ?');
const updateTile = db.prepare('UPDATE world SET building = ? WHERE x = ? AND y = ?');
const getNearbyNPCs = db.prepare('SELECT * FROM npcs WHERE ABS(x - ?) <= 5 AND ABS(y - ?) <= 5');

// Recipes
const RECIPES = {
  house: { wood: 10, stone: 5 },
  sword: { wood: 2, stone: 3 },
  pickaxe: { wood: 1, stone: 5 }
};

io.on('connection', (socket) => {
  console.log('Player connected:', socket.id);

  socket.on('join', (name) => {
    let player = getPlayer.get(socket.id);
    if (!player) {
      player = { id: socket.id, name, x: 25, y: 25, hp: 100, maxhp: 100, inv: '[]', level: 1 };
      savePlayer.run(player.id, player.name, player.x, player.y, player.hp, player.maxhp, player.inv, player.level);
    }
    socket.player = player;
    players.set(socket.id, player);
    socket.emit('init', { player, world: getViewport(player.x, player.y) });
    io.emit('playerJoined', player);
  });

  socket.on('move', (dir) => {
    const moves = { north: [0, -1], south: [0, 1], east: [1, 0], west: [-1, 0] };
    const [dx, dy] = moves[dir] || [0, 0];
    const newX = Math.max(0, Math.min(49, socket.player.x + dx));
    const newY = Math.max(0, Math.min(49, socket.player.y + dy));
    
    socket.player.x = newX;
    socket.player.y = newY;
    savePlayer.run(socket.player.id, socket.player.name, newX, newY, socket.player.hp, socket.player.maxhp, socket.player.inv, socket.player.level);
    
    socket.emit('moved', { player: socket.player, world: getViewport(newX, newY) });
    socket.broadcast.emit('playerMoved', { id: socket.id, x: newX, y: newY });
  });

  socket.on('gather', () => {
    const tile = getTile.get(socket.player.x, socket.player.y);
    const inv = JSON.parse(socket.player.inv);
    
    let item = 'wood';
    if (tile.terrain === 'mountain') item = 'stone';
    if (tile.terrain === 'forest') item = Math.random() > 0.5 ? 'wood' : 'berry';
    
    inv.push(item);
    socket.player.inv = JSON.stringify(inv);
    savePlayer.run(socket.player.id, socket.player.name, socket.player.x, socket.player.y, socket.player.hp, socket.player.maxhp, socket.player.inv, socket.player.level);
    
    socket.emit('gathered', { item, inv });
  });

  socket.on('craft', (item) => {
    const recipe = RECIPES[item];
    if (!recipe) return;
    
    const inv = JSON.parse(socket.player.inv);
    const canCraft = Object.entries(recipe).every(([mat, count]) => 
      inv.filter(i => i === mat).length >= count
    );
    
    if (canCraft) {
      Object.entries(recipe).forEach(([mat, count]) => {
        for (let i = 0; i < count; i++) {
          inv.splice(inv.indexOf(mat), 1);
        }
      });
      socket.player.inv = JSON.stringify(inv);
      savePlayer.run(socket.player.id, socket.player.name, socket.player.x, socket.player.y, socket.player.hp, socket.player.maxhp, socket.player.inv, socket.player.level);
      
      socket.emit('crafted', { item, inv });
    }
  });

  socket.on('build', (building) => {
    updateTile.run(building, socket.player.x, socket.player.y);
    io.emit('built', { x: socket.player.x, y: socket.player.y, building });
  });

  socket.on('chat', (msg) => {
    io.emit('chat', { name: socket.player.name, msg, time: Date.now() });
  });

  socket.on('disconnect', () => {
    players.delete(socket.id);
    io.emit('playerLeft', socket.id);
  });
});

function getViewport(x, y) {
  const tiles = [];
  for (let dy = -7; dy <= 7; dy++) {
    for (let dx = -7; dx <= 7; dx++) {
      const tile = getTile.get(x + dx, y + dy);
      if (tile) tiles.push({ ...tile, rx: dx, ry: dy });
    }
  }
  const npcs = getNearbyNPCs.all(x, y);
  return { tiles, npcs, players: Array.from(players.values()) };
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`🎮 MUD running on port ${PORT}`));
