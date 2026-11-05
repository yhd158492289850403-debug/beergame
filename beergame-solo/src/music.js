(function () {
  'use strict';
  const button = document.getElementById('musicToggle');
  const volume = document.getElementById('musicVolume');
  let context, master, timer, enabled = false, beat = 0;
  const chords = [[48,55,60,64],[45,52,57,60],[41,48,53,57],[43,50,55,59]];
  function tick() {
    if (!enabled || document.hidden || context.state !== 'running') return;
    const chord = chords[Math.floor(beat / 8) % chords.length];
    const notes = [chord[beat % 4] + 12];
    if (beat % 4 === 0) notes.push(chord[0]);
    notes.forEach(note => {
      const oscillator = context.createOscillator(), gain = context.createGain(), now = context.currentTime;
      oscillator.type = 'sine'; oscillator.frequency.value = 440 * Math.pow(2,(note - 69) / 12);
      gain.gain.setValueAtTime(0,now); gain.gain.linearRampToValueAtTime(0.16,now + 0.035); gain.gain.exponentialRampToValueAtTime(0.001,now + 1.5);
      oscillator.connect(gain); gain.connect(master); oscillator.start(now); oscillator.stop(now + 1.6);
      oscillator.onended = () => { oscillator.disconnect(); gain.disconnect(); };
    }); beat++;
  }
  button.onclick = async () => {
    button.disabled = true;
    try {
      if (!context) { context = new (window.AudioContext || window.webkitAudioContext)(); master = context.createGain(); master.connect(context.destination); }
      enabled = !enabled;
      if (enabled) { await context.resume(); master.gain.value = Number(volume.value) / 100; tick(); timer = setInterval(tick,420); }
      else { clearInterval(timer); await context.suspend(); }
      button.textContent = enabled ? '背景音乐：开' : '背景音乐：关'; button.setAttribute('aria-pressed',String(enabled));
    } catch (_) { enabled = false; clearInterval(timer); button.textContent = '音乐暂不可用'; }
    finally { button.disabled = false; }
  };
  volume.oninput = () => { if (master) master.gain.setTargetAtTime(Number(volume.value) / 100, context.currentTime, 0.05); };
  document.addEventListener('visibilitychange', () => { if (context && enabled) { if (document.hidden) context.suspend(); else context.resume().catch(() => {}); } });
})();
