const DIALOGUES_ZH = ['喵~','别戳我！','嗯？','想我了？','(´・ω・`)','有什么事吗~','好无聊啊...','陪我玩！','哼！','摸摸头~','在忙呢...','嘿嘿~','干嘛啦~','好痒！'];
const DIALOGUES_EN = ['Meow~',"Don't poke me!",'Hmm?','Miss me?','(´・ω・`)',"What's up~","So bored...",'Play with me!','Hmph!','Pat pat~',"I'm busy...",'Hehe~','What~','That tickles!'];

let pets = [];
let currentPetIdx = 0;
let action = 'default';
let frameIdx = 0;
let animTimer = null;
let autoTimer = null;
let isDragging = false;
let dragStartX = 0, dragStartY = 0;
let winStartX = 0, winStartY = 0;
let backendUrl = 'http://localhost:18600';

const img = document.getElementById('pet-img');
const bubble = document.getElementById('pet-bubble');
const nameEl = document.getElementById('pet-name');
const selector = document.getElementById('selector');
const container = document.getElementById('pet-container');

async function init() {
  backendUrl = await window.petBridge.getBackendUrl();
  const savedPet = await window.petBridge.getSavedPet();

  try {
    const res = await fetch(`${backendUrl}/api/pets`);
    pets = await res.json();
  } catch { pets = []; }

  if (pets.length === 0) { img.alt = 'No pets found'; return; }

  currentPetIdx = Math.max(0, pets.findIndex(p => p.id === savedPet));
  buildSelector();
  startPet();

  window.petBridge.onStateChange((state) => {
    if (state === 'working' && pets[currentPetIdx]?.actions?.work) {
      setAction('work');
    } else if (state === 'idle' && action === 'work') {
      setAction('default');
    }
  });
}

function currentPet() { return pets[currentPetIdx]; }

function buildSelector() {
  selector.innerHTML = '';
  pets.forEach((p, idx) => {
    const div = document.createElement('div');
    div.className = `sel-item ${idx === currentPetIdx ? 'active' : ''}`;
    const act = p.actions.default || Object.values(p.actions)[0];
    div.innerHTML = `<img src="${backendUrl}${p.folder}/action/${act.images}_0.png"><span>${p.name}</span>`;
    div.onclick = (e) => { e.stopPropagation(); selectPet(idx); };
    selector.appendChild(div);
  });
}

function selectPet(idx) {
  currentPetIdx = idx;
  window.petBridge.savePet(pets[idx].id);
  selector.classList.remove('show');
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
  animTimer = setInterval(() => {
    frameIdx = (frameIdx + 1) % act.frames;
    updateFrame();
    if (act.need_move && !isDragging) {
      const move = act.frame_move || 3;
      const dir = act.direction === 'left' ? -move : move;
      window.petBridge.getPosition().then(pos => {
        const newX = pos[0] + dir;
        if (newX < 0 || newX > screen.width - 200) {
          setAction('default');
        } else {
          window.petBridge.moveWindow(newX, pos[1]);
        }
      });
    }
  }, act.interval);
}

function updateFrame() {
  const pet = currentPet();
  const act = pet.actions[action] || pet.actions.default;
  img.src = `${backendUrl}${pet.folder}/action/${act.images}_${frameIdx}.png`;
}

function stopAnim() { clearInterval(animTimer); animTimer = null; }

function scheduleAuto() {
  clearTimeout(autoTimer);
  if (isDragging) return;
  autoTimer = setTimeout(() => {
    if (isDragging) return;
    const pet = currentPet();
    if (!pet) return;
    const rand = Math.random();
    if (rand < 0.25 && pet.actions.left_walk) {
      setAction('left_walk');
      setTimeout(() => { setAction('default'); scheduleAuto(); }, 3000);
    } else if (rand < 0.5 && pet.actions.right_walk) {
      setAction('right_walk');
      setTimeout(() => { setAction('default'); scheduleAuto(); }, 3000);
    } else if (rand < 0.65 && pet.actions.sleep) {
      setAction('sleep');
      setTimeout(() => { setAction('default'); scheduleAuto(); }, 5000);
    } else {
      setAction('default');
      scheduleAuto();
    }
  }, 3000 + Math.random() * 4000);
}

// Drag
container.addEventListener('mousedown', (e) => {
  if (e.button !== 0) return;
  isDragging = true;
  dragStartX = e.screenX;
  dragStartY = e.screenY;
  window.petBridge.getPosition().then(pos => { winStartX = pos[0]; winStartY = pos[1]; });
  const pet = currentPet();
  if (pet?.actions?.drag) setAction('drag');
  clearTimeout(autoTimer);
});

document.addEventListener('mousemove', (e) => {
  if (!isDragging) return;
  const dx = e.screenX - dragStartX;
  const dy = e.screenY - dragStartY;
  window.petBridge.moveWindow(winStartX + dx, winStartY + dy);
});

document.addEventListener('mouseup', () => {
  if (!isDragging) return;
  isDragging = false;
  const pet = currentPet();
  if (pet?.actions?.fall) {
    setAction('fall');
    setTimeout(() => {
      if (pet?.actions?.onfloor) {
        setAction('onfloor');
        setTimeout(() => { setAction('default'); scheduleAuto(); }, 1500);
      } else {
        setAction('default'); scheduleAuto();
      }
    }, 800);
  } else {
    setAction('default'); scheduleAuto();
  }
});

// Click
container.addEventListener('click', (e) => {
  if (e.detail === 1 && !isDragging) {
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
  selector.classList.toggle('show');
});

document.addEventListener('click', (e) => {
  if (!selector.contains(e.target) && selector.classList.contains('show')) {
    selector.classList.remove('show');
  }
});

init();
