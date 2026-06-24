const $ = (id) => document.getElementById(id);

const pinBtn = $('pinBtn');
const closeBtn = $('closeBtn');
const playBtn = $('playBtn');
const statusEl = $('status');

let running = false;

closeBtn.addEventListener('click', () => window.api.close());

pinBtn.addEventListener('click', async () => {
  const pinned = await window.api.togglePin();
  pinBtn.classList.toggle('pinned', pinned);
  pinBtn.title = pinned ? 'Unpin' : 'Pin on top';
});

window.api.onCountdown((remaining) => {
  if (remaining > 0) {
    statusEl.textContent = `Starting in ${remaining}s — switch to your target app...`;
  } else if (running) {
    statusEl.textContent = 'Typing...';
  }
});

function setRunning(state) {
  running = state;
  playBtn.textContent = state ? '■ Stop' : '▶ Play';
  playBtn.classList.toggle('running', state);
}

playBtn.addEventListener('click', async () => {
  if (running) {
    window.api.cancel();
    setRunning(false);
    statusEl.textContent = 'Stopped.';
    return;
  }

  const text = $('text').value;
  if (!text) {
    statusEl.textContent = 'Please enter some text first.';
    return;
  }

  const opts = {
    charDelay: $('charDelay').value,
    lineDelay: $('lineDelay').value,
    playDelay: $('playDelay').value,
    text
  };

  setRunning(true);
  statusEl.textContent = 'Preparing...';

  const result = await window.api.play(opts);

  setRunning(false);

  if (result.ok) {
    statusEl.textContent = 'Task complete ✅';
  } else if (result.cancelled) {
    statusEl.textContent = 'Stopped.';
  } else {
    statusEl.textContent = 'Error: ' + (result.error || 'unknown');
  }
});
