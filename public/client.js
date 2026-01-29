const socket = io();
let player = null;
let worldData = null;
let tileset = null;
let tilesetLoaded = false;

const canvas = document.getElementById('map');
const ctx = canvas.getContext('2d');
const TILE_SIZE = 30;
const SPRITE_SIZE = 16; // размер спрайта в тайлсете

// Загрузка тайлсета
const tilesetImg = new Image();
tilesetImg.src = 'tileset.png';
tilesetImg.onload = () => {
  tilesetLoaded = true;
  console.log('✅ Тайлсет загружен!');
  if (worldData) renderWorld(worldData);
};
tilesetImg.onerror = () => {
  console.log('⚠️ Тайлсет не найден, используем запасной рендеринг');
  tilesetLoaded = false;
};

// Mapping спрайтов в тайлсете (координаты x,y в сетке 16x16)
const SPRITES = {
  // Terrain
  grass: [1, 0],
  forest: [2, 0],
  mountain: [3, 0],
  desert: [4, 0],
  swamp: [5, 0],
  snow: [6, 0],
  town: [7, 0],
  water: [8, 0],
  
  // Player
  player: [0, 1],
  
  // NPCs
  npc: [1, 1],
  merchant: [2, 1],
  blacksmith: [3, 1],
  
  // Mobs
  slime: [0, 2],
  goblin: [1, 2],
  skeleton: [2, 2],
  wolf: [3, 2],
  orc: [4, 2],
  
  // Buildings
  house: [0, 3],
  sword: [1, 3],
  pickaxe: [2, 3],
  
  // Items
  wood: [0, 4],
  stone: [1, 4],
  iron: [2, 4],
  gold: [3, 4]
};

// Fallback цвета если тайлсет не загружен
const TERRAIN_COLORS = {
  grass: '#2a5a2a',
  forest: '#1a4d1a',
  mountain: '#666',
  desert: '#d4a76a',
  swamp: '#4a6b4a',
  snow: '#e0f0ff',
  town: '#8b7355',
  water: '#1e3a5f'
};

function join() {
  const name = document.getElementById('name-input').value.trim();
  if (!name) return alert('Введите имя!');
  if (name.length < 2) return alert('Имя должно быть минимум 2 символа!');
  socket.emit('join', name);
  document.getElementById('login-screen').classList.add('hidden');
}

// Socket events
socket.on('init', ({ player: p, world }) => {
  player = p;
  worldData = world;
  updateUI();
  renderWorld(world);
  log('🎮 Добро пожаловать в MUD Песочницу!');
  log('💡 WASD - движение, E - собрать, клик по мобу - атака');
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
  log(`🔨 Создано: ${item}`, 'success');
});

socket.on('built', ({ x, y, building }) => {
  log(`🏗️ Построено: ${building}`);
  if (worldData) {
    const tile = worldData.tiles.find(t => t.x === x && t.y === y);
    if (tile) tile.building = building;
    renderWorld(worldData);
  }
});

socket.on('combatLog', (msg) => {
  log(`⚔️ ${msg}`, 'combat');
});

socket.on('levelUp', (level) => {
  log(`🎉 LEVEL UP! Теперь уровень ${level}!`, 'success');
  showNotification('LEVEL UP!', 'success');
});

socket.on('playerUpdate', (p) => {
  player = p;
  updateUI();
});

socket.on('mobsUpdate', (mobs) => {
  if (worldData && player) {
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
    if (mob) {
      mob.hp = hp;
      renderWorld(worldData);
    }
  }
});

socket.on('chat', ({ name, msg }) => {
  const chat = document.getElementById('chat');
  const time = new Date().toLocaleTimeString('ru', { hour: '2-digit', minute: '2-digit' });
  const div = document.createElement('div');
  div.className = 'chat-msg';
  div.innerHTML = `<span class="time">${time}</span> <b>${escapeHtml(name)}:</b> ${escapeHtml(msg)}`;
  chat.appendChild(div);
  chat.scrollTop = chat.scrollHeight;
  
  // Лимит сообщений
  while (chat.children.length > 50) {
    chat.removeChild(chat.firstChild);
  }
});

// Controls
let keys = {};
document.addEventListener('keydown', (e) => {
  // ВАЖНО: блокируем WASD если фокус на input или textarea
  const activeEl = document.activeElement;
  if (activeEl && (activeEl.tagName === 'INPUT' || activeEl.tagName === 'TEXTAREA')) {
    return; // не обрабатываем WASD в полях ввода
  }
  
  keys[e.key] = true;
  
  const moves = { 
    w: 'north', s: 'south', a: 'west', d: 'east', 
    W: 'north', S: 'south', A: 'west', D: 'east',
    ArrowUp: 'north', ArrowDown: 'south', ArrowLeft: 'west', ArrowRight: 'east' 
  };
  
  if (moves[e.key] && !keys._moving) {
    e.preventDefault();
    keys._moving = true;
    socket.emit('move', moves[e.key]);
    setTimeout(() => { keys._moving = false; }, 150); // Защита от спама
  }
  
  if ((e.key === 'e' || e.key === 'E') && !keys._gathering) {
    e.preventDefault();
    keys._gathering = true;
    socket.emit('gather');
    setTimeout(() => { keys._gathering = false; }, 300);
  }
});

document.addEventListener('keyup', (e) => {
  keys[e.key] = false;
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
      log('⚠️ Слишком далеко! Подойдите ближе.', 'error');
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
  
  // HP bar
  const hpPercent = Math.max(0, Math.min(100, (player.hp / player.maxhp) * 100));
  const hpBar = document.getElementById('hp-bar');
  if (hpBar) {
    hpBar.style.width = hpPercent + '%';
    if (hpPercent > 50) hpBar.style.backgroundColor = '#00ff41';
    else if (hpPercent > 25) hpBar.style.backgroundColor = '#ffaa00';
    else hpBar.style.backgroundColor = '#ff0000';
  }
  
  // Inventory
  const inv = JSON.parse(player.inv || '[]');
  const counts = {};
  inv.forEach(item => counts[item] = (counts[item] || 0) + 1);
  
  const invContainer = document.getElementById('inv-items');
  if (Object.keys(counts).length === 0) {
    invContainer.innerHTML = '<div class="empty">Пусто</div>';
  } else {
    invContainer.innerHTML = Object.entries(counts)
      .map(([item, count]) => 
        `<div class="inv-item"><span>${item}</span><span class="count">x${count}</span></div>`
      ).join('');
  }
}

function renderWorld(world) {
  if (!world || !player) return;
  
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  
  // Render tiles
  world.tiles.forEach(tile => {
    const x = (tile.rx + 7) * TILE_SIZE;
    const y = (tile.ry + 7) * TILE_SIZE;
    
    if (tilesetLoaded && SPRITES[tile.terrain]) {
      drawSprite(SPRITES[tile.terrain], x, y);
    } else {
      // Fallback
      ctx.fillStyle = TERRAIN_COLORS[tile.terrain] || '#333';
      ctx.fillRect(x, y, TILE_SIZE, TILE_SIZE);
    }
    
    // Убрал grid - он давал зазоры в 1px
    
    // Buildings
    if (tile.building) {
      if (tilesetLoaded && SPRITES[tile.building]) {
        drawSprite(SPRITES[tile.building], x, y);
      } else {
        ctx.fillStyle = '#ffaa00';
        ctx.font = 'bold 16px monospace';
        const icon = tile.building === 'house' ? '🏠' : '⚒️';
        ctx.fillText(icon, x + 7, y + 20);
      }
    }
  });
  
  // NPCs
  if (world.npcs) {
    world.npcs.forEach(npc => {
      const x = (npc.x - player.x + 7) * TILE_SIZE;
      const y = (npc.y - player.y + 7) * TILE_SIZE;
      if (x >= 0 && x < 450 && y >= 0 && y < 450) {
        if (tilesetLoaded && SPRITES.npc) {
          drawSprite(SPRITES.npc, x, y);
        } else {
          ctx.fillStyle = '#00aaff';
          ctx.font = 'bold 20px monospace';
          ctx.fillText('👤', x + 5, y + 22);
        }
        // Quest indicator
        ctx.fillStyle = '#ffff00';
        ctx.font = 'bold 12px monospace';
        ctx.fillText('!', x + 20, y + 10);
      }
    });
  }
  
  // Mobs
  if (world.mobs) {
    world.mobs.forEach(mob => {
      const x = (mob.x - player.x + 7) * TILE_SIZE;
      const y = (mob.y - player.y + 7) * TILE_SIZE;
      if (x >= 0 && x < 450 && y >= 0 && y < 450) {
        if (tilesetLoaded && SPRITES[mob.type]) {
          drawSprite(SPRITES[mob.type], x, y);
        } else {
          const emojis = { slime: '💧', goblin: '👺', skeleton: '💀', wolf: '🐺', orc: '👹' };
          ctx.font = '18px monospace';
          ctx.fillText(emojis[mob.type] || '👾', x + 6, y + 20);
        }
        
        // HP bar
        const hpPercent = Math.max(0, Math.min(1, mob.hp / mob.maxhp));
        ctx.fillStyle = hpPercent > 0.5 ? '#00ff00' : (hpPercent > 0.25 ? '#ffaa00' : '#ff0000');
        ctx.fillRect(x + 2, y + 2, (TILE_SIZE - 4) * hpPercent, 3);
        ctx.strokeStyle = '#000';
        ctx.strokeRect(x + 2, y + 2, TILE_SIZE - 4, 3);
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
        if (tilesetLoaded && SPRITES.player) {
          drawSprite(SPRITES.player, x, y);
        } else {
          ctx.fillStyle = '#ffff00';
          ctx.font = 'bold 18px monospace';
          ctx.fillText('👤', x + 6, y + 20);
        }
        // Name tag
        ctx.fillStyle = '#fff';
        ctx.font = 'bold 10px monospace';
        ctx.strokeStyle = '#000';
        ctx.lineWidth = 3;
        ctx.strokeText(p.name, x - 5, y - 2);
        ctx.fillText(p.name, x - 5, y - 2);
      }
    });
  }
  
  // Player (center)
  const px = 7 * TILE_SIZE;
  const py = 7 * TILE_SIZE;
  if (tilesetLoaded && SPRITES.player) {
    drawSprite(SPRITES.player, px, py);
  } else {
    ctx.fillStyle = '#00ff41';
    ctx.font = 'bold 22px monospace';
    ctx.fillText('@', px + 8, py + 22);
  }
  
  // Highlight player tile
  ctx.strokeStyle = 'rgba(0, 255, 65, 0.6)';
  ctx.lineWidth = 2;
  ctx.strokeRect(px, py, TILE_SIZE, TILE_SIZE);
  ctx.lineWidth = 1;
  
  // Minimap
  drawMinimap();
}

function drawSprite(spriteCoords, x, y) {
  if (!tilesetLoaded) return;
  const [sx, sy] = spriteCoords;
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(
    tilesetImg,
    sx * SPRITE_SIZE, sy * SPRITE_SIZE, SPRITE_SIZE, SPRITE_SIZE,
    x, y, TILE_SIZE, TILE_SIZE
  );
}

function drawMinimap() {
  const minimap = document.getElementById('minimap');
  if (!minimap || !worldData || !player) return;
  
  const mctx = minimap.getContext('2d');
  const scale = 2;
  
  mctx.fillStyle = '#000';
  mctx.fillRect(0, 0, 200, 200);
  
  worldData.tiles.forEach(tile => {
    const x = (tile.rx + 7) * scale;
    const y = (tile.ry + 7) * scale;
    mctx.fillStyle = TERRAIN_COLORS[tile.terrain] || '#333';
    mctx.fillRect(x, y, scale, scale);
  });
  
  // Mobs on minimap
  if (worldData.mobs) {
    worldData.mobs.forEach(mob => {
      const x = (mob.x - player.x + 7) * scale;
      const y = (mob.y - player.y + 7) * scale;
      if (x >= 0 && x < 200 && y >= 0 && y < 200) {
        mctx.fillStyle = '#ff0000';
        mctx.fillRect(x, y, scale, scale);
      }
    });
  }
  
  // Player on minimap (bigger)
  mctx.fillStyle = '#00ff41';
  mctx.fillRect(7 * scale - 1, 7 * scale - 1, scale * 2 + 2, scale * 2 + 2);
  mctx.strokeStyle = '#fff';
  mctx.strokeRect(7 * scale - 1, 7 * scale - 1, scale * 2 + 2, scale * 2 + 2);
}

function log(msg, type = 'info') {
  const log = document.getElementById('log');
  const time = new Date().toLocaleTimeString('ru', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  const colors = { 
    info: '#00ff41', 
    combat: '#ff6600', 
    success: '#ffff00', 
    error: '#ff0000' 
  };
  
  const div = document.createElement('div');
  div.style.color = colors[type];
  div.innerHTML = `<span class="time">${time}</span> ${escapeHtml(msg)}`;
  log.appendChild(div);
  log.scrollTop = log.scrollHeight;
  
  // Лимит логов
  while (log.children.length > 100) {
    log.removeChild(log.firstChild);
  }
}

function showNotification(text, type = 'info') {
  const notif = document.createElement('div');
  notif.className = `notification ${type}`;
  notif.textContent = text;
  document.body.appendChild(notif);
  
  setTimeout(() => {
    notif.classList.add('show');
  }, 10);
  
  setTimeout(() => {
    notif.classList.remove('show');
    setTimeout(() => notif.remove(), 300);
  }, 3000);
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// Auto-save reminder
setInterval(() => {
  if (player) {
    console.log('💾 Автосохранение...');
  }
}, 60000);
