import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const server = createServer(app);
const io = new Server(server, {
  cors: { origin: '*', methods: ['GET', 'POST'] }
});

const db = new Database('world.db');

app.use(express.static(path.join(__dirname, 'public')));
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

function migrateDatabase() {
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all();
  
  if (tables.some(t => t.name === 'players')) {
    const columns = db.pragma('table_info(players)');
    
    if (columns.length < 12) {
      console.log('🔄 Обнаружена старая БД, выполняю миграцию...');
      
      db.exec(`
        DROP TABLE IF EXISTS players_old;
        ALTER TABLE players RENAME TO players_old;
      `);
      
      db.exec(`
        CREATE TABLE players (
          id TEXT PRIMARY KEY, 
          name TEXT, 
          x INT DEFAULT 25, 
          y INT DEFAULT 25,
          hp INT DEFAULT 100, 
          maxhp INT DEFAULT 100, 
          inv TEXT DEFAULT '[]', 
          level INT DEFAULT 1, 
          exp INT DEFAULT 0, 
          gold INT DEFAULT 0,
          attack INT DEFAULT 10, 
          defense INT DEFAULT 5
        );
      `);
      
      try {
        db.exec(`
          INSERT INTO players (id, name, x, y, hp, maxhp, inv, level)
          SELECT id, name, x, y, hp, maxhp, inv, level FROM players_old;
        `);
        db.exec('DROP TABLE players_old;');
        console.log('✅ Миграция завершена!');
      } catch (e) {
        console.log('⚠️ Миграция данных пропущена, используем новую схему');
        db.exec('DROP TABLE IF EXISTS players_old;');
      }
    }
  }
}

db.exec(`
  CREATE TABLE IF NOT EXISTS players (
    id TEXT PRIMARY KEY, 
    name TEXT, 
    x INT DEFAULT 25, 
    y INT DEFAULT 25,
    hp INT DEFAULT 100, 
    maxhp INT DEFAULT 100, 
    inv TEXT DEFAULT '[]', 
    level INT DEFAULT 1, 
    exp INT DEFAULT 0, 
    gold INT DEFAULT 0,
    attack INT DEFAULT 10, 
    defense INT DEFAULT 5
  );
  CREATE TABLE IF NOT EXISTS world (
    x INT, 
    y INT, 
    terrain TEXT DEFAULT 'grass', 
    building TEXT, 
    items TEXT DEFAULT '[]',
    PRIMARY KEY (x, y)
  );
  CREATE TABLE IF NOT EXISTS npcs (
    id INT PRIMARY KEY, 
    name TEXT, 
    x INT, 
    y INT, 
    quest TEXT, 
    dialog TEXT, 
    questReward TEXT DEFAULT '{"exp":50,"gold":10}'
  );
  CREATE TABLE IF NOT EXISTS mobs (
    id TEXT PRIMARY KEY, 
    type TEXT, 
    x INT, 
    y INT, 
    hp INT, 
    maxhp INT, 
    attack INT, 
    exp INT, 
    loot TEXT
  );
`);

migrateDatabase();

const insertTile = db.prepare('INSERT OR IGNORE INTO world (x, y, terrain) VALUES (?, ?, ?)');
const worldExists = db.prepare('SELECT COUNT(*) as count FROM world').get();

if (worldExists.count === 0) {
  console.log('🌍 Генерация мира...');
  const genWorld = db.transaction(() => {
    for (let x = 0; x < 100; x++) {
      for (let y = 0; y < 100; y++) {
        let terrain = 'grass';
        const rand = Math.random();
        const distFromCenter = Math.sqrt(Math.pow(x - 50, 2) + Math.pow(y - 50, 2));
        
        if (distFromCenter < 10) terrain = 'town';
        else if (rand > 0.92) terrain = 'mountain';
        else if (rand > 0.8) terrain = 'forest';
        else if (rand > 0.7) terrain = 'desert';
        else if (rand > 0.65) terrain = 'swamp';
        else if (rand > 0.6) terrain = 'snow';
        
        insertTile.run(x, y, terrain);
      }
    }
  });
  genWorld();
  console.log('✅ Мир создан!');
}

const npcExists = db.prepare('SELECT COUNT(*) as count FROM npcs').get();
if (npcExists.count === 0) {
  const insertNPC = db.prepare('INSERT INTO npcs VALUES (?, ?, ?, ?, ?, ?, ?)');
  insertNPC.run(1, 'Старик', 50, 50, 'slime:5', 'Убей 5 слаймов!', '{"exp":100,"gold":50}');
  insertNPC.run(2, 'Кузнец', 52, 50, 'iron:10', 'Принеси 10 железа', '{"exp":200,"gold":100,"item":"iron_sword"}');
  insertNPC.run(3, 'Торговец', 48, 50, 'wood:20', 'Собери 20 дерева', '{"exp":150,"gold":75}');
  console.log('✅ NPC созданы!');
}

const players = new Map();
const mobs = new Map();

const getPlayer = db.prepare('SELECT * FROM players WHERE id = ?');
const savePlayer = db.prepare(
  'INSERT OR REPLACE INTO players (id, name, x, y, hp, maxhp, inv, level, exp, gold, attack, defense) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
);
const getTile = db.prepare('SELECT * FROM world WHERE x = ? AND y = ?');
const updateTile = db.prepare('UPDATE world SET building = ? WHERE x = ? AND y = ?');
const getNearbyNPCs = db.prepare('SELECT * FROM npcs WHERE ABS(x - ?) <= 7 AND ABS(y - ?) <= 7');
const saveMob = db.prepare('INSERT OR REPLACE INTO mobs VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)');
const loadMobs = db.prepare('SELECT * FROM mobs');
const deleteMob = db.prepare('DELETE FROM mobs WHERE id = ?');

loadMobs.all().forEach(mob => {
  mobs.set(mob.id, mob);
});

const RECIPES = {
  house: { wood: 10, stone: 5 },
  sword: { wood: 2, stone: 3 },
  pickaxe: { wood: 1, stone: 5 },
  iron_sword: { iron: 5, wood: 2 },
  armor: { iron: 10, leather: 5 },
  bow: { wood: 5, string: 3 },
  potion: { herb: 3, water: 1 }
};

// Terrain-based resource gathering
const TERRAIN_RESOURCES = {
  mountain: ['stone', 'iron', 'gold_ore'],
  forest: ['wood', 'berry', 'herb'],
  grass: ['herb', 'flower'],
  desert: ['cactus', 'sand'],
  swamp: ['herb', 'water', 'slime_gel'],
  snow: ['ice', 'snow_crystal'],
  town: [] // В городе ничего не собирается
};

const MOB_TYPES = {
  slime: { hp: 30, attack: 5, exp: 20, loot: ['slime_gel', 'slime_gel', 'gold'] },
  goblin: { hp: 50, attack: 10, exp: 40, loot: ['gold', 'gold', 'leather'] },
  skeleton: { hp: 70, attack: 15, exp: 60, loot: ['bone', 'gold', 'iron'] },
  wolf: { hp: 60, attack: 12, exp: 50, loot: ['leather', 'meat'] },
  orc: { hp: 100, attack: 20, exp: 100, loot: ['gold', 'iron', 'iron'] }
};

function spawnMob(type, x, y) {
  const id = `mob_${Date.now()}_${Math.random()}`;
  const mobData = MOB_TYPES[type];
  const mob = {
    id, type, x, y,
    hp: mobData.hp,
    maxhp: mobData.hp,
    attack: mobData.attack,
    exp: mobData.exp,
    loot: JSON.stringify(mobData.loot)
  };
  mobs.set(id, mob);
  saveMob.run(mob.id, mob.type, mob.x, mob.y, mob.hp, mob.maxhp, mob.attack, mob.exp, mob.loot);
  return mob;
}

if (mobs.size < 20) {
  for (let i = 0; i < 30; i++) {
    const types = ['slime', 'goblin', 'wolf', 'skeleton'];
    const type = types[Math.floor(Math.random() * types.length)];
    const x = Math.floor(Math.random() * 100);
    const y = Math.floor(Math.random() * 100);
    spawnMob(type, x, y);
  }
  console.log(`✅ Заспавнено ${mobs.size} мобов`);
}

setInterval(() => {
  mobs.forEach(mob => {
    const moves = [[0,1], [0,-1], [1,0], [-1,0]];
    const [dx, dy] = moves[Math.floor(Math.random() * moves.length)];
    mob.x = Math.max(0, Math.min(99, mob.x + dx));
    mob.y = Math.max(0, Math.min(99, mob.y + dy));
    saveMob.run(mob.id, mob.type, mob.x, mob.y, mob.hp, mob.maxhp, mob.attack, mob.exp, mob.loot);
  });
  io.emit('mobsUpdate', Array.from(mobs.values()));
}, 3000);

io.on('connection', (socket) => {
  console.log('🎮 Игрок подключился:', socket.id);

  socket.on('join', (name) => {
    let player = getPlayer.get(socket.id);
    if (!player) {
      player = { 
        id: socket.id, name, x: 50, y: 50, hp: 100, maxhp: 100, 
        inv: '[]', level: 1, exp: 0, gold: 0, attack: 10, defense: 5 
      };
      savePlayer.run(player.id, player.name, player.x, player.y, player.hp, 
        player.maxhp, player.inv, player.level, player.exp, player.gold, player.attack, player.defense);
    }
    socket.player = player;
    players.set(socket.id, player);
    socket.emit('init', { player, world: getViewport(player.x, player.y) });
    io.emit('playerJoined', player);
    console.log(`${name} вошёл в игру (${players.size} игроков онлайн)`);
  });

  socket.on('move', (dir) => {
    if (!socket.player) return;
    const moves = { north: [0, -1], south: [0, 1], east: [1, 0], west: [-1, 0] };
    const [dx, dy] = moves[dir] || [0, 0];
    const newX = Math.max(0, Math.min(99, socket.player.x + dx));
    const newY = Math.max(0, Math.min(99, socket.player.y + dy));
    
    socket.player.x = newX;
    socket.player.y = newY;
    savePlayer.run(socket.player.id, socket.player.name, newX, newY, socket.player.hp,
      socket.player.maxhp, socket.player.inv, socket.player.level, socket.player.exp, 
      socket.player.gold, socket.player.attack, socket.player.defense);
    
    socket.emit('moved', { player: socket.player, world: getViewport(newX, newY) });
    socket.broadcast.emit('playerMoved', { id: socket.id, x: newX, y: newY });
  });

  socket.on('gather', () => {
    if (!socket.player) return;
    const tile = getTile.get(socket.player.x, socket.player.y);
    if (!tile) return;
    
    // Проверяем можно ли собирать ресурсы на этом terrain
    const possibleItems = TERRAIN_RESOURCES[tile.terrain];
    
    if (!possibleItems || possibleItems.length === 0) {
      socket.emit('gatherFailed', `Здесь нечего собирать! (${tile.terrain})`);
      return;
    }
    
    const inv = JSON.parse(socket.player.inv);
    const item = possibleItems[Math.floor(Math.random() * possibleItems.length)];
    
    inv.push(item);
    socket.player.inv = JSON.stringify(inv);
    savePlayer.run(socket.player.id, socket.player.name, socket.player.x, socket.player.y,
      socket.player.hp, socket.player.maxhp, socket.player.inv, socket.player.level, 
      socket.player.exp, socket.player.gold, socket.player.attack, socket.player.defense);
    
    socket.emit('gathered', { item, inv });
  });

  socket.on('craft', (item) => {
    if (!socket.player) return;
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
      inv.push(item);
      socket.player.inv = JSON.stringify(inv);
      savePlayer.run(socket.player.id, socket.player.name, socket.player.x, socket.player.y,
        socket.player.hp, socket.player.maxhp, socket.player.inv, socket.player.level,
        socket.player.exp, socket.player.gold, socket.player.attack, socket.player.defense);
      
      socket.emit('crafted', { item, inv });
    }
  });

  socket.on('build', (building) => {
    if (!socket.player) return;
    updateTile.run(building, socket.player.x, socket.player.y);
    io.emit('built', { x: socket.player.x, y: socket.player.y, building });
  });

  socket.on('attack', (mobId) => {
    if (!socket.player) return;
    const mob = mobs.get(mobId);
    if (!mob) return;
    
    const distance = Math.abs(mob.x - socket.player.x) + Math.abs(mob.y - socket.player.y);
    if (distance > 2) return;
    
    const damage = socket.player.attack + Math.floor(Math.random() * 5);
    mob.hp -= damage;
    
    socket.emit('combatLog', `Вы нанесли ${damage} урона ${mob.type}!`);
    
    if (mob.hp <= 0) {
      const loot = JSON.parse(mob.loot);
      const inv = JSON.parse(socket.player.inv);
      loot.forEach(item => inv.push(item));
      
      socket.player.exp += mob.exp;
      socket.player.gold += Math.floor(Math.random() * 20) + 10;
      
      const expNeeded = socket.player.level * 100;
      if (socket.player.exp >= expNeeded) {
        socket.player.level++;
        socket.player.exp = 0;
        socket.player.maxhp += 20;
        socket.player.hp = socket.player.maxhp;
        socket.player.attack += 5;
        socket.player.defense += 2;
        socket.emit('levelUp', socket.player.level);
      }
      
      socket.player.inv = JSON.stringify(inv);
      savePlayer.run(socket.player.id, socket.player.name, socket.player.x, socket.player.y,
        socket.player.hp, socket.player.maxhp, socket.player.inv, socket.player.level,
        socket.player.exp, socket.player.gold, socket.player.attack, socket.player.defense);
      
      mobs.delete(mobId);
      deleteMob.run(mobId);
      io.emit('mobDied', mobId);
      socket.emit('combatLog', `${mob.type} убит! Получено: ${loot.join(', ')}`);
      
      setTimeout(() => {
        const types = Object.keys(MOB_TYPES);
        const newType = types[Math.floor(Math.random() * types.length)];
        spawnMob(newType, Math.floor(Math.random() * 100), Math.floor(Math.random() * 100));
      }, 5000);
    } else {
      saveMob.run(mob.id, mob.type, mob.x, mob.y, mob.hp, mob.maxhp, mob.attack, mob.exp, mob.loot);
      io.emit('mobHit', { id: mobId, hp: mob.hp });
      
      const mobDamage = mob.attack - socket.player.defense;
      const actualDamage = Math.max(1, mobDamage);
      socket.player.hp -= actualDamage;
      
      socket.emit('combatLog', `${mob.type} нанёс вам ${actualDamage} урона!`);
      
      if (socket.player.hp <= 0) {
        socket.player.hp = socket.player.maxhp;
        socket.player.x = 50;
        socket.player.y = 50;
        socket.emit('combatLog', 'Вы умерли! Возрождение в городе.');
      }
      
      savePlayer.run(socket.player.id, socket.player.name, socket.player.x, socket.player.y,
        socket.player.hp, socket.player.maxhp, socket.player.inv, socket.player.level,
        socket.player.exp, socket.player.gold, socket.player.attack, socket.player.defense);
      socket.emit('playerUpdate', socket.player);
    }
  });

  socket.on('chat', (msg) => {
    if (!socket.player) return;
    io.emit('chat', { name: socket.player.name, msg, time: Date.now() });
  });

  socket.on('disconnect', () => {
    if (socket.player) {
      console.log(`${socket.player.name} покинул игру`);
      players.delete(socket.id);
    }
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
  const nearbyMobs = Array.from(mobs.values()).filter(m => 
    Math.abs(m.x - x) <= 7 && Math.abs(m.y - y) <= 7
  );
  return { tiles, npcs, mobs: nearbyMobs, players: Array.from(players.values()) };
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`\n🎮 MUD Песочница запущена!`);
  console.log(`📡 Сервер: http://localhost:${PORT}`);
  console.log(`👥 Игроков онлайн: 0`);
  console.log(`👹 Мобов в мире: ${mobs.size}\n`);
});
