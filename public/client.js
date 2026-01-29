const socket = io();
let player = null;

const canvas = document.getElementById('map');
const ctx = canvas.getContext('2d');
const TILE_SIZE = 30;

const TERRAIN_COLORS = {
  grass: '#2a4d2a',
  forest: '#1a3d1a',
  mountain: '#666',
  water: '#1e3a5f'
};

function join() {
  const name = document.getElementById('name-input').value.trim();
  if (!name) return alert('Введите имя!');
  socket.emit('join', name);
  document.getElementById('login-screen').classList.add('hidden');
}

socket.on('init', ({ player: p, world }) => {
  player = p;
  updateUI();
  renderWorld(world);
  log('Вы вошли в мир!');
});

socket.on('moved', ({ player: p, world }) => {
  player = p;
  updateUI();
  renderWorld(world);
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

socket.on('chat', ({ name, msg }) => {
  const chat = document.getElementById('chat');
  chat.innerHTML += `<div><b>${name}:</b> ${msg}</div>`;
  chat.scrollTop = chat.scrollHeight;
});

// Controls
document.addEventListener('keydown', (e) => {
  const moves = { w: 'north', s: 'south', a: 'west', d: 'east', 
                  ArrowUp: 'north', ArrowDown: 'south', ArrowLeft: 'west', ArrowRight: 'east' };
  if (moves[e.key]) {
    e.preventDefault();
    socket.emit('move', moves[e.key]);
  }
  if (e.key === 'e' || e.key === 'E') {
    socket.emit('gather');
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
  socket.emit('build', item);
}

function updateUI() {
  if (!player) return;
  document.getElementById('player-name').textContent = player.name;
  document.getElementById('hp').textContent = player.hp;
  document.getElementById('maxhp').textContent = player.maxhp;
  document.getElementById('level').textContent = player.level;
  
  const inv = JSON.parse(player.inv);
  const counts = {};
  inv.forEach(item => counts[item] = (counts[item] || 0) + 1);
  document.getElementById('inv-items').innerHTML = 
    Object.entries(counts).map(([item, count]) => `${item} x${count}`).join('<br>') || 'Пусто';
}

function renderWorld(world) {
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  
  world.tiles.forEach(tile => {
    const x = (tile.rx + 7) * TILE_SIZE;
    const y = (tile.ry + 7) * TILE_SIZE;
    ctx.fillStyle = TERRAIN_COLORS[tile.terrain] || '#333';
    ctx.fillRect(x, y, TILE_SIZE, TILE_SIZE);
    
    if (tile.building) {
      ctx.fillStyle = '#ff0';
      ctx.fillText(tile.building[0].toUpperCase(), x + 10, y + 20);
    }
  });
  
  // Player in center
  ctx.fillStyle = '#00ff41';
  ctx.fillRect(7 * TILE_SIZE + 10, 7 * TILE_SIZE + 10, 10, 10);
}

function log(msg) {
  const log = document.getElementById('log');
  log.innerHTML += `<br>> ${msg}`;
  log.scrollTop = log.scrollHeight;
}
