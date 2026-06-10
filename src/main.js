import RAPIER from '@dimforge/rapier3d-compat';
import { Game }  from './game.js';
import { Input } from './input.js';

await RAPIER.init();

const input    = new Input();
const overlay  = document.getElementById('overlay');
const startBtn = document.getElementById('start-btn');
let   game     = null;

startBtn.addEventListener('click', async () => {
  overlay.style.display = 'none';
  startBtn.disabled     = true;

  game = new Game(RAPIER, input, () => {
    // Game over — wait, then return to title
    setTimeout(() => {
      document.exitPointerLock();
      game.destroy();
      game = null;

      const msg = document.getElementById('message');
      setTimeout(() => {
        msg.style.opacity   = '0';
        msg.textContent     = '';
        overlay.style.display = 'flex';
        startBtn.disabled   = false;
      }, 1800);
    }, 2500);
  });

  game.start();

  // Request pointer lock after starting so the browser allows it
  document.body.requestPointerLock();
});

// Re-request pointer lock if user clicks the canvas while game is running
document.addEventListener('click', () => {
  if (game && !document.pointerLockElement) {
    document.body.requestPointerLock();
  }
});
