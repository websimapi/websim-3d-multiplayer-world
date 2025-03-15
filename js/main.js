import { initScene, animate } from './scene.js';
import { setupMovementControls } from './controls.js';
import { setupMultiplayer } from './multiplayer.js';
import { setupUI } from './ui.js';

// Initialize the multiplayer room
const room = new WebsimSocket();

// Initialize app components
initScene(room);
setupMovementControls(room);
setupMultiplayer(room);
setupUI(room);

// Start animation loop
animate();