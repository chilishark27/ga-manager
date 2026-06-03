const DIALOGUES_ZH = ['喵~','别戳我！','嗯？','想我了？','(´・ω・`)','有什么事吗~','好无聊啊...','陪我玩！','哼！','摸摸头~','在忙呢...','嘿嘿~','干嘛啦~','好痒！'];
const DIALOGUES_EN = ['Meow~',"Don't poke me!",'Hmm?','Miss me?','(´・ω・`)',"What's up~","So bored...",'Play with me!','Hmph!','Pat pat~',"I'm busy...",'Hehe~','What~','That tickles!'];

let pets = [];
let currentPetIdx = 0;
let action = 'default';
let frameIdx = 0;
let animTimer = null;
let autoTimer = null;
let backendUrl = 'http://localhost:18600';

const img = document.getElementById('pet-img');
const bubble = document.getElementById('pet-bubble');
const nameEl = document.getElementById('pet-name');
const selector = document.getElementById('selector');
const container = document.getElementById('pet-container');

async function init() {
  if (window.petBridge) {
    backendUrl = await window.petBridge.getBackendUrl();
    const savedPet = await window.petBridge.getSavedPet();
    try {
      const res = await fetch(`${backendUrl}/api/pets`);
      pets = await res.json();
    } catch { pets = []; }
    if (pets.length === 0) { img.alt = 'No pets found'; return; }
    currentPetIdx = Math.max(0, pets.findIndex(p => p.id === savedPet));
  } else {
    // Fallback: running in browser without petBridge
    try {
      const res = await fetch('/api/pets');
      pets = await res.json();
    } catch { pets = []; }
    if (pets.length === 0) { img.alt = 'No pets found'; return; }
    backendUrl = '';
    currentPetIdx = 0;
  }
  buildSelector();
  startPet();

  if (window.petBridge) {
    window.petBridge.onStateChange((state) => {
      if (state === 'working' && pets[currentPetIdx]?.actions?.work) {
        setAction('work');
      } else if (state === 'idle' && action === 'work') {
        setAction('default');
      }
    });
  }
}

function currentPet() { return pets[currentPetIdx]; }

function buildSelector() {
  selector.innerHTML = '';
  pets.forEach((p, idx) => {
    const div = document.createElement('div');
    div.className = `sel-item ${idx === currentPetIdx ? 'active' : ''}`;
    const act = p.actions.default || Object.values(p.actions)[0];
    div.innerHTML = `<img src="${encodeURI(backendUrl + p.folder + '/action/' + act.images + '_' + padNum(0, act.pad) + '.png')}"><span>${p.name}</span>`;
    div.onclick = (e) => { e.stopPropagation(); selectPet(idx); };
    selector.appendChild(div);
  });
}

function selectPet(idx) {
  currentPetIdx = idx;
  if (window.petBridge) window.petBridge.savePet(pets[idx].id);
  selector.classList.remove('show');
  if (window.petBridge) window.petBridge.resizeWindow(250, 250);
  buildSelector();
  stopAnim();
  startPet();
}

function startPet() {
  const pet = currentPet();
  if (!pet) return;
  nameEl.textContent = pet.name;
  setAction('default');
  scheduleAuto();
}

function setAction(name) {
  const pet = currentPet();
  if (!pet) return;
  const act = pet.actions[name] || pet.actions.default;
  if (!act) return;
  action = name;
  frameIdx = 0;
  stopAnim();
  updateFrame();

  // Tell main process to start/stop walking
  if (window.petBridge) {
    if (act.need_move || name.includes('walk')) {
      const dir = (act.direction === 'left' || name.includes('left')) ? -1 : 1;
      const speed = act.frame_move || 2;
      window.petBridge.walkStart(dir, speed);
    } else {
      window.petBridge.walkStop();
    }
  }

  animTimer = setInterval(async () => {
    frameIdx = (frameIdx + 1) % act.frames;
    updateFrame();
  }, act.interval);
}

function padNum(n, pad) {
  return pad ? String(n).padStart(pad, '0') : String(n);
}

function updateFrame() {
  const pet = currentPet();
  const act = pet.actions[action] || pet.actions.default;
  img.src = encodeURI(`${backendUrl}${pet.folder}/action/${act.images}_${padNum(frameIdx, act.pad)}.png`);
}

function stopAnim() { clearInterval(animTimer); animTimer = null; }

function scheduleAuto() {
  clearTimeout(autoTimer);
  autoTimer = setTimeout(() => {
    const pet = currentPet();
    if (!pet) return;
    const rand = Math.random();
    if (rand < 0.25 && pet.actions.left_walk) {
      setAction('left_walk');
      setTimeout(() => { setAction('default'); scheduleAuto(); }, 8000 + Math.random() * 6000);
    } else if (rand < 0.5 && pet.actions.right_walk) {
      setAction('right_walk');
      setTimeout(() => { setAction('default'); scheduleAuto(); }, 8000 + Math.random() * 6000);
    } else if (rand < 0.65 && pet.actions.sleep) {
      setAction('sleep');
      setTimeout(() => { setAction('default'); scheduleAuto(); }, 8000 + Math.random() * 5000);
    } else {
      setAction('default');
      scheduleAuto();
    }
  }, 5000 + Math.random() * 5000);
}

// Drag: left-click on pet image to drag
// Main process polls cursor position and moves window
let dragging = false;

img.addEventListener('mousedown', (e) => {
  if (e.button !== 0) return;
  e.preventDefault(); // prevent native image drag
  dragging = true;
  if (window.petBridge) window.petBridge.dragStart();
});

document.addEventListener('mouseup', () => {
  if (!dragging) return;
  dragging = false;
  if (window.petBridge) window.petBridge.dragEnd();
});

// Safety net: detect missed mouseup (cursor left window during drag)
document.addEventListener('mousemove', (e) => {
  if (dragging && e.buttons === 0) {
    dragging = false;
    if (window.petBridge) window.petBridge.dragEnd();
  }
});

// Walk done callback from main process (hit screen edge — reverse direction)
if (window.petBridge) {
  window.petBridge.onWalkDone(() => {
    const pet = currentPet();
    if (!pet) return;
    // Reverse: if was walking left, walk right and vice versa
    if (action === 'left_walk' && pet.actions.right_walk) {
      setAction('right_walk');
    } else if (action === 'right_walk' && pet.actions.left_walk) {
      setAction('left_walk');
    } else {
      setAction('default');
      scheduleAuto();
    }
  });
}

// Toggle (hide) button
document.getElementById('toggle-btn').addEventListener('click', (e) => {
  e.stopPropagation();
  if (window.petBridge) {
    window.petBridge.moveWindow(-9999, -9999); // Move off-screen to "hide"
  }
});

// Click
container.addEventListener('click', (e) => {
  if (e.detail === 1) {
    img.classList.add('bounce');
    setTimeout(() => img.classList.remove('bounce'), 400);
    const msgs = DIALOGUES_ZH;
    bubble.textContent = msgs[Math.floor(Math.random() * msgs.length)];
    bubble.style.display = 'block';
    setTimeout(() => { bubble.style.display = 'none'; }, 2500);
    const pet = currentPet();
    const patpat = pet?.actions?.patpat || pet?.actions?.patpat_1;
    if (patpat) {
      setAction(pet.actions.patpat ? 'patpat' : 'patpat_1');
      setTimeout(() => { setAction('default'); scheduleAuto(); }, 2000);
    }
  }
});

// Right-click: selector
container.addEventListener('contextmenu', (e) => {
  e.preventDefault();
  const showing = !selector.classList.contains('show');
  selector.classList.toggle('show');
  if (window.petBridge) {
    if (showing) {
      window.petBridge.resizeWindow(250, 300);
    } else {
      window.petBridge.resizeWindow(250, 250);
    }
  }
});

document.addEventListener('click', (e) => {
  if (!selector.contains(e.target) && selector.classList.contains('show')) {
    selector.classList.remove('show');
    if (window.petBridge) window.petBridge.resizeWindow(250, 250);
  }
});

init();
