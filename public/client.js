const socket = io();
let player = null;
let worldData = null;

const canvas = document.getElementById('map');
const ctx = canvas.getContext('2d');
const TILE_SIZE = 30;

const TERRAIN_COLORS = {
  grass: '#2a5a2a',
  forest: '#1a4d1a',
  mountain: '#666',
  desert: '#d4a76a',
  swamp: '#4a6b4a',
  snow: '#e0f0ff',
  town: '#8b7355'
};

const TERRAIN_EMOJI = {
  grass: '🌱',
  forest: '🌲',
  mountain: '⛰️',
  desert: '🏜️',
  swamp: '🌿',
  snow: '❄️',
  town: '🏘️'
};

function join() {
  const name = document.getElementById('name-input').value.trim();
  if (!name) return alert('Введите имя!');
  socket.emit('join', name);
  document.getElementById('login-screen').classList.add('hidden');
}

socket.on('init', ({ player: p, world }) => {
  player = p;
  worldData = world;
  updateUI();
  renderWorld(world);
  log('Добро пожаловать в MUD Песочницу! 🎮');
  log('Управление: WASD - движение, E - собрать, клик по мобу - атака');
});

socket.on('moved', ({ player: p, world }) => {
  player = p;
  worldData = world;
  updateUI();
  renderWorld(world);
});

socket.on('gathered', ({ item, inv }) => {
  player.inv = JSON.stringify(inv);
  updateUI();
  log(`✅ Собрано: ${item}`);
});

socket.on('crafted', ({ item, inv }) => {
  player.inv = JSON.stringify(inv);
  updateUI();
  log(`🔨 Создано: ${item}`);
});

socket.on('built', ({ x, y, building }) => {
  log(`🏗️ Построено: ${building} на (${x}, ${y})`);
});

socket.on('combatLog', (msg) => {
  log(`⚔️ ${msg}`, 'combat');
});

socket.on('levelUp', (level) => {
  log(`🎉 LEVEL UP! Теперь уровень ${level}!`, 'success');
  playSound('levelup');
});

socket.on('playerUpdate', (p) => {
  player = p;
  updateUI();
});

socket.on('mobsUpdate', (mobs) => {
  if (worldData) {
    worldData.mobs = mobs.filter(m => 
      Math.abs(m.x - player.x) <= 7 && Math.abs(m.y - player.y) <= 7
    );
    renderWorld(worldData);
  }
});

socket.on('mobDied', (mobId) => {
  if (worldData) {
    worldData.mobs = worldData.mobs.filter(m => m.id !== mobId);
    renderWorld(worldData);
  }
});

socket.on('mobHit', ({ id, hp }) => {
  if (worldData) {
    const mob = worldData.mobs.find(m => m.id === id);
    if (mob) mob.hp = hp;
    renderWorld(worldData);
  }
});

socket.on('chat', ({ name, msg }) => {
  const chat = document.getElementById('chat');
  const time = new Date().toLocaleTimeString('ru', { hour: '2-digit', minute: '2-digit' });
  chat.innerHTML += `<div class="chat-msg"><span class="time">${time}</span> <b>${name}:</b> ${msg}</div>`;
  chat.scrollTop = chat.scrollHeight;
});

// Controls
document.addEventListener('keydown', (e) => {
  if (document.activeElement.id === 'chat-input') return;
  
  const moves = { 
    w: 'north', s: 'south', a: 'west', d: 'east', 
    W: 'north', S: 'south', A: 'west', D: 'east',
    ArrowUp: 'north', ArrowDown: 'south', ArrowLeft: 'west', ArrowRight: 'east' 
  };
  
  if (moves[e.key]) {
    e.preventDefault();
    socket.emit('move', moves[e.key]);
  }
  
  if (e.key === 'e' || e.key === 'E') {
    e.preventDefault();
    socket.emit('gather');
  }
});

canvas.addEventListener('click', (e) => {
  if (!worldData || !player) return;
  
  const rect = canvas.getBoundingClientRect();
  const clickX = Math.floor((e.clientX - rect.left) / TILE_SIZE) - 7;
  const clickY = Math.floor((e.clientY - rect.top) / TILE_SIZE) - 7;
  
  const clickedMob = worldData.mobs.find(m => 
    m.x - player.x === clickX && m.y - player.y === clickY
  );
  
  if (clickedMob) {
    const distance = Math.abs(clickX) + Math.abs(clickY);
    if (distance <= 2) {
      socket.emit('attack', clickedMob.id);
    } else {
      log('⚠️ Слишком далеко! Подойдите ближе.');
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

function updateUI() {
  if (!player) return;
  
  document.getElementById('player-name').textContent = player.name;
  document.getElementById('hp').textContent = player.hp;
  document.getElementById('maxhp').textContent = player.maxhp;
  document.getElementById('level').textContent = player.level;
  document.getElementById('exp').textContent = player.exp;
  document.getElementById('gold').textContent = player.gold || 0;
  document.getElementById('attack').textContent = player.attack;
  document.getElementById('defense').textContent = player.defense;
  
  const hpPercent = (player.hp / player.maxhp) * 100;
  const hpBar = document.getElementById('hp-bar');
  if (hpBar) {
    hpBar.style.width = hpPercent + '%';
    hpBar.style.backgroundColor = hpPercent > 50 ? '#00ff41' : (hpPercent > 25 ? '#ffaa00' : '#ff0000');
  }
  
  const inv = JSON.parse(player.inv);
  const counts = {};
  inv.forEach(item => counts[item] = (counts[item] || 0) + 1);
  
  document.getElementById('inv-items').innerHTML = 
    Object.entries(counts).map(([item, count]) => 
      `<div class="inv-item">${item} <span class="count">x${count}</span></div>`
    ).join('') || '<div class="empty">Пусто</div>';
}

function renderWorld(world) {
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  
  // Terrain
  world.tiles.forEach(tile => {
    const x = (tile.rx + 7) * TILE_SIZE;
    const y = (tile.ry + 7) * TILE_SIZE;
    ctx.fillStyle = TERRAIN_COLORS[tile.terrain] || '#333';
    ctx.fillRect(x, y, TILE_SIZE, TILE_SIZE);
    
    // Grid
    ctx.strokeStyle = 'rgba(0, 255, 65, 0.1)';
    ctx.strokeRect(x, y, TILE_SIZE, TILE_SIZE);
    
    // Buildings
    if (tile.building) {
      ctx.fillStyle = '#ffaa00';
      ctx.font = '16px monospace';
      ctx.fillText(tile.building === 'house' ? '🏠' : '⚒️', x + 7, y + 20);
    }
  });
  
  // NPCs
  if (world.npcs) {
    world.npcs.forEach(npc => {
      const x = (npc.x - player.x + 7) * TILE_SIZE;
      const y = (npc.y - player.y + 7) * TILE_SIZE;
      if (x >= 0 && x < 450 && y >= 0 && y < 450) {
        ctx.fillStyle = '#00aaff';
        ctx.font = '20px monospace';
        ctx.fillText('👤', x + 5, y + 22);
      }
    });
  }
  
  // Mobs
  if (world.mobs) {
    world.mobs.forEach(mob => {
      const x = (mob.x - player.x + 7) * TILE_SIZE;
      const y = (mob.y - player.y + 7) * TILE_SIZE;
      if (x >= 0 && x < 450 && y >= 0 && y < 450) {
        const emoji = { slime: '💧', goblin: '👺', skeleton: '💀', wolf: '🐺', orc: '👹' }[mob.type] || '👾';
        ctx.font = '18px monospace';
        ctx.fillText(emoji, x + 6, y + 20);
        
        // HP bar
        const hpPercent = mob.hp / mob.maxhp;
        ctx.fillStyle = hpPercent > 0.5 ? '#00ff00' : (hpPercent > 0.25 ? '#ffaa00' : '#ff0000');
        ctx.fillRect(x + 2, y + 2, (TILE_SIZE - 4) * hpPercent, 3);
      }
    });
  }
  
  // Other players
  if (world.players) {
    world.players.forEach(p => {
      if (p.id === player.id) return;
      const x = (p.x - player.x + 7) * TILE_SIZE;
      const y = (p.y - player.y + 7) * TILE_SIZE;
      if (x >= 0 && x < 450 && y >= 0 && y < 450) {
        ctx.fillStyle = '#ffff00';
        ctx.font = '18px monospace';
        ctx.fillText('👤', x + 6, y + 20);
        ctx.fillStyle = '#fff';
        ctx.font = '10px monospace';
        ctx.fillText(p.name, x, y - 2);
      }
    });
  }
  
  // Player (center)
  ctx.fillStyle = '#00ff41';
  ctx.font = '20px monospace';
  ctx.fillText('@', 7 * TILE_SIZE + 10, 7 * TILE_SIZE + 22);
  
  // Minimap
  drawMinimap();
}

function drawMinimap() {
  const minimap = document.getElementById('minimap');
  if (!minimap) return;
  const mctx = minimap.getContext('2d');
  const scale = 2;
  
  mctx.fillStyle = '#000';
  mctx.fillRect(0, 0, 200, 200);
  
  if (worldData && worldData.tiles) {
    worldData.tiles.forEach(tile => {
      const x = (tile.rx + 7) * scale;
      const y = (tile.ry + 7) * scale;
      mctx.fillStyle = TERRAIN_COLORS[tile.terrain] || '#333';
      mctx.fillRect(x, y, scale, scale);
    });
  }
  
  // Player on minimap
  mctx.fillStyle = '#00ff41';
  mctx.fillRect(7 * scale, 7 * scale, scale * 2, scale * 2);
}

function log(msg, type = 'info') {
  const log = document.getElementById('log');
  const time = new Date().toLocaleTimeString('ru', { hour: '2-digit', minute: '2-digit' });
  const color = { info: '#00ff41', combat: '#ff6600', success: '#ffff00', error: '#ff0000' }[type];
  log.innerHTML += `<div style="color: ${color}"><span class="time">${time}</span> ${msg}</div>`;
  log.scrollTop = log.scrollHeight;
  
  if (log.children.length > 100) {
    log.removeChild(log.firstChild);
  }
}

function playSound(type) {
  // Placeholder for future sound system
  console.log('🔊', type);
}
