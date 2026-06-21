import RAPIER from '@dimforge/rapier3d-compat';
import { Game }  from './game.js';
import { Input } from './input.js';
import { audio } from './audio.js';

await RAPIER.init();

const input    = new Input();
const overlay  = document.getElementById('overlay');
const startBtn = document.getElementById('start-btn');
const demoBtn  = document.getElementById('demo-btn');
let   game     = null;

function startGame({ auto = false } = {}) {
  overlay.style.display = 'none';
  startBtn.disabled     = true;
  demoBtn.disabled      = true;
  audio.resume();   // unlock the AudioContext from this click gesture

  game = new Game(RAPIER, input, () => {
    // Game over — wait, then return to title
    setTimeout(() => {
      document.exitPointerLock();
      game.destroy();
      game = null;

      const msg = document.getElementById('message');
      setTimeout(() => {
        msg.style.opacity     = '0';
        msg.textContent       = '';
        overlay.style.display = 'flex';
        startBtn.disabled     = false;
        demoBtn.disabled      = false;
      }, 1800);
    }, 2500);
  }, { auto });

  game.start();

  // Only the playable mode captures the mouse; the auto-battle is just watched.
  if (!auto) document.body.requestPointerLock();
}

startBtn.addEventListener('click', () => startGame());
demoBtn.addEventListener('click',  () => startGame({ auto: true }));

// Re-request pointer lock if the user clicks the canvas while playing
document.addEventListener('click', () => {
  if (game && !game.auto && !document.pointerLockElement) {
    document.body.requestPointerLock();
  }
});
