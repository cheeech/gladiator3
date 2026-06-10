export class Input {
  constructor() {
    this.keys  = {};
    this.mouse = {
      locked:     false,
      dx:         0,
      dy:         0,
      buttons:    {},   // 0=LMB, 1=MMB, 2=RMB
      swipeDX:    0,
      swipeDY:    0,
      swipeActive: false,
    };

    window.addEventListener('keydown', e => {
      this.keys[e.code] = true;
      if (['Space','ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(e.code))
        e.preventDefault();
    });
    window.addEventListener('keyup', e => { this.keys[e.code] = false; });

    document.addEventListener('pointerlockchange', () => {
      this.mouse.locked = !!document.pointerLockElement;
    });

    document.addEventListener('mousemove', e => {
      if (!this.mouse.locked) return;
      this.mouse.dx += e.movementX;
      this.mouse.dy += e.movementY;
      if (this.mouse.swipeActive) {
        this.mouse.swipeDX += e.movementX;
        this.mouse.swipeDY += e.movementY;
      }
    });

    document.addEventListener('mousedown', e => {
      this.mouse.buttons[e.button] = true;
      if (e.button === 0 && this.mouse.locked) {
        this.mouse.swipeActive = true;
        this.mouse.swipeDX    = 0;
        this.mouse.swipeDY    = 0;
      }
    });

    document.addEventListener('mouseup', e => {
      this.mouse.buttons[e.button] = false;
      if (e.button === 0) this.mouse.swipeActive = false;
    });

    window.addEventListener('contextmenu', e => e.preventDefault());
  }

  isDown(...codes) {
    return codes.some(c => this.keys[c]);
  }

  flush() {
    this.mouse.dx = 0;
    this.mouse.dy = 0;
  }

  // Returns accumulated swipe delta and resets it
  consumeSwipe() {
    const { swipeDX: dx, swipeDY: dy } = this.mouse;
    this.mouse.swipeDX = 0;
    this.mouse.swipeDY = 0;
    return { dx, dy };
  }
}
