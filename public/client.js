const socket = io();
let player = null;
let world = null;

const canvas = document.getElementById('map');
const ctx = canvas.getContext('2d');
const TILE_SIZE = 30;

const TERRAIN_COLORS = {
  grass: '#2a4d2a',
  forest: '#1a3d1a',
  mountain: '#666',
  water: '#1e3a5f',
  desert: '#d4a574',
  swamp: '#3d5c3d',
  snow: '#e0f0ff',
  town: '#8b4513'
};

const MOB_COLORS = {
  slime: '#0f0',
  goblin: '#f90',
  skeleton: '#ccc',
  wolf: '#888',
  orc: '#f00'
};

function join() {
  const name = document.getElementById('name-input').value.trim();
  if (!name) return alert('Введите имя!');
  socket.emit('join', name);
  document.getElementById('login-screen').classList.add('hidden');
}

socket.on('init', (data) => {
  player = data.player;
  world = data.world;
  updateUI();
  renderWorld();
  log('Вы вошли в мир!');
});

socket.on('moved', (data) => {
  player = data.player;
  world = data.world;
  updateUI();
  renderWorld();
});

socket.on('gathered', ({ item, inv }) => {
  player.inv = JSON.stringify(inv);
  updateUI();
  log(`Собрано: ${item}`);
});

socket.on('crafted', ({ item, inv }) => {
  player.inv = JSON.stringify(inv);
  updateUI();
  log(`Создано: ${item}`);
});

socket.on('built', ({ x, y, building }) => {
  log(`Построено: ${building} на (${x}, ${y})`);
});

socket.on('combatLog', (msg) => {
  log(`⚔️ ${msg}`, '#ff4444');
});

socket.on('levelUp', (level) => {
  log(`🎉 Уровень повышен! Теперь ${level} уровень!`, '#ffff00');
  playSound('levelup');
});

socket.on('playerUpdate', (p) => {
  player = p;
  updateUI();
});

socket.on('mobsUpdate', (mobs) => {
  if (world) {
    world.mobs = mobs.filter(m => 
      Math.abs(m.x - player.x) <= 7 && Math.abs(m.y - player.y) <= 7
    );
    renderWorld();
  }
});

socket.on('mobDied', (mobId) => {
  if (world) {
    world.mobs = world.mobs.filter(m => m.id !== mobId);
    renderWorld();
  }
});

socket.on('mobHit', ({ id, hp }) => {
  if (world) {
    const mob = world.mobs.find(m => m.id === id);
    if (mob) mob.hp = hp;
    renderWorld();
  }
});

socket.on('chat', ({ name, msg }) => {
  const chat = document.getElementById('chat');
  chat.innerHTML += `<div><b>${name}:</b> ${msg}</div>`;
  chat.scrollTop = chat.scrollHeight;
});

// Controls
document.addEventListener('keydown', (e) => {
  const moves = { 
    w: 'north', s: 'south', a: 'west', d: 'east', 
    ArrowUp: 'north', ArrowDown: 'south', ArrowLeft: 'west', ArrowRight: 'east' 
  };
  if (moves[e.key]) {
    e.preventDefault();
    socket.emit('move', moves[e.key]);
  }
  if (e.key === 'e' || e.key === 'E') {
    socket.emit('gather');
  }
  if (e.key === ' ') {
    attackNearestMob();
  }
});

canvas.addEventListener('click', (e) => {
  const rect = canvas.getBoundingClientRect();
  const x = Math.floor((e.clientX - rect.left) / TILE_SIZE) - 7;
  const y = Math.floor((e.clientY - rect.top) / TILE_SIZE) - 7;
  
  if (world && world.mobs) {
    const mob = world.mobs.find(m => m.x - player.x === x && m.y - player.y === y);
    if (mob) {
      socket.emit('attack', mob.id);
    }
  }
});

document.getElementById('chat-input').addEventListener('keypress', (e) => {
  if (e.key === 'Enter' && e.target.value.trim()) {
    socket.emit('chat', e.target.value.trim());
    e.target.value = '';
  }
});

function craft(item) {
  socket.emit('craft', item);
}

function buildItem(item) {
  socket.emit('build', item);
}

function attackNearestMob() {
  if (!world || !world.mobs) return;
  const nearMobs = world.mobs.filter(m => {
    const dist = Math.abs(m.x - player.x) + Math.abs(m.y - player.y);
    return dist <= 2;
  });
  if (nearMobs.length > 0) {
    socket.emit('attack', nearMobs[0].id);
  }
}

function updateUI() {
  if (!player) return;
  document.getElementById('player-name').textContent = player.name;
  document.getElementById('hp').textContent = player.hp;
  document.getElementById('maxhp').textContent = player.maxhp;
  document.getElementById('level').textContent = player.level;
  document.getElementById('exp').textContent = player.exp;
  document.getElementById('gold').textContent = player.gold;
  document.getElementById('attack').textContent = player.attack;
  document.getElementById('defense').textContent = player.defense;
  
  const hpBar = document.getElementById('hp-bar');
  const hpPercent = (player.hp / player.maxhp) * 100;
  hpBar.style.width = hpPercent + '%';
  hpBar.style.backgroundColor = hpPercent > 50 ? '#0f0' : hpPercent > 25 ? '#ff0' : '#f00';
  
  const expBar = document.getElementById('exp-bar');
  const expNeeded = player.level * 100;
  const expPercent = (player.exp / expNeeded) * 100;
  expBar.style.width = expPercent + '%';
  
  const inv = JSON.parse(player.inv);
  const counts = {};
  inv.forEach(item => counts[item] = (counts[item] || 0) + 1);
  document.getElementById('inv-items').innerHTML = 
    Object.entries(counts).map(([item, count]) => `${item} x${count}`).join('<br>') || 'Пусто';
}

function renderWorld() {
  if (!world) return;
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  
  world.tiles.forEach(tile => {
    const x = (tile.rx + 7) * TILE_SIZE;
    const y = (tile.ry + 7) * TILE_SIZE;
    ctx.fillStyle = TERRAIN_COLORS[tile.terrain] || '#333';
    ctx.fillRect(x, y, TILE_SIZE, TILE_SIZE);
    
    if (tile.building) {
      ctx.fillStyle = '#ff0';
      ctx.font = '20px monospace';
      ctx.fillText(tile.building[0].toUpperCase(), x + 5, y + 22);
    }
  });
  
  // NPCs
  if (world.npcs) {
    world.npcs.forEach(npc => {
      const x = (npc.x - player.x + 7) * TILE_SIZE;
      const y = (npc.y - player.y + 7) * TILE_SIZE;
      ctx.fillStyle = '#00f';
      ctx.fillRect(x + 5, y + 5, 20, 20);
      ctx.fillStyle = '#fff';
      ctx.font = '10px monospace';
      ctx.fillText('?', x + 12, y + 18);
    });
  }
  
  // Mobs
  if (world.mobs) {
    world.mobs.forEach(mob => {
      const x = (mob.x - player.x + 7) * TILE_SIZE;
      const y = (mob.y - player.y + 7) * TILE_SIZE;
      ctx.fillStyle = MOB_COLORS[mob.type] || '#f00';
      ctx.fillRect(x + 7, y + 7, 16, 16);
      
      // HP bar
      const hpPercent = mob.hp / mob.maxhp;
      ctx.fillStyle = '#f00';
      ctx.fillRect(x, y - 3, 30, 2);
      ctx.fillStyle = '#0f0';
      ctx.fillRect(x, y - 3, 30 * hpPercent, 2);
    });
  }
  
  // Other players
  if (world.players) {
    world.players.forEach(p => {
      if (p.id === player.id) return;
      const x = (p.x - player.x + 7) * TILE_SIZE;
      const y = (p.y - player.y + 7) * TILE_SIZE;
      ctx.fillStyle = '#0ff';
      ctx.fillRect(x + 10, y + 10, 10, 10);
    });
  }
  
  // Player in center
  ctx.fillStyle = '#00ff41';
  ctx.fillRect(7 * TILE_SIZE + 10, 7 * TILE_SIZE + 10, 10, 10);
}

function log(msg, color = '#00ff41') {
  const logEl = document.getElementById('log');
  logEl.innerHTML += `<br><span style="color:${color}">> ${msg}</span>`;
  logEl.scrollTop = logEl.scrollHeight;
}

function playSound(type) {
  // Placeholder for sound effects
}
