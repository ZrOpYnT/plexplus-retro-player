"use strict";
/* Original RetroTV adapter. Only the documented YouTube IFrame API plays media. */
(function () {
    'use strict';
    let player = null, pending = null, apiStarted = false, dead = false;
    let revision = 0, currentId = '', state = -1, error = 0, ready = false;
    let blocked = false, active = true, volume = 70, timeout = null, started = false, randomStart = false;
    let captions = false, captionStatus = 'off', applyingCaptions = false, captionLoadId = '';
    let pictureRatio = 16 / 9;
    let tubeRatio = 16 / 9, pictureMode = 0, revealGeneration = 0, fullscreenPicture = false;
    const pictureKnobs = { brightness: 50, contrast: 50, color: 50 };
    let pictureVisible = false, revealTimeout = null, tunedAt = 0, revealMs = 0;
    const clock = () => (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
    // Reveal after a short settling window and confirmed playback motion.
    // Keep the same player across channels; do not add a multi-second artificial wait.
    // A CRT's raster filled its tube; up to this much horizontal stretch meets glass that is wider
    // (or narrower) than the clip before any cropping is needed.
    const TUBE_STRETCH = 1.08;
    const REVEAL_WINDOW = 650, START_LIMIT = 15000, STALL_LIMIT = 10000;
    const durations = new Map();
    let firstPlayMs = 0;
    let firstPlayAt = -1, wantPlay = false, startTimer = null, stallTimer = null, startGeneration = 0, stallGeneration = 0;
    // Content aspect from metadata (4:3 until known) and whether the set is a flat panel without CRT overscan.
    let contentRatio = 4 / 3, flatPanel = false;
    let feedbackTimeout = null, noiseFrame = null, tuning = false, screenEra = 3;
    let noiseAudio = null, noiseGain = null, noiseSource = null;
    function hiss(on) {
        try {
            const Context = window.AudioContext || window.webkitAudioContext;
            if (on && !noiseAudio && Context) {
                noiseAudio = new Context();
                const buffer = noiseAudio.createBuffer(1,noiseAudio.sampleRate,noiseAudio.sampleRate),samples=buffer.getChannelData(0);
                for(let i=0;i<samples.length;i++)samples[i]=Math.random()*2-1;
                noiseSource=noiseAudio.createBufferSource();noiseSource.buffer=buffer;noiseSource.loop=true;
                const filter=noiseAudio.createBiquadFilter();filter.type='lowpass';filter.frequency.value=5500;
                noiseGain=noiseAudio.createGain();noiseGain.gain.value=0;noiseSource.connect(filter);filter.connect(noiseGain);noiseGain.connect(noiseAudio.destination);noiseSource.start();
            }
            if(noiseGain)noiseGain.gain.setTargetAtTime(on ? .018 * volume/100 : 0,noiseAudio.currentTime,.025);
            if(on&&noiseAudio&&noiseAudio.state==='suspended')noiseAudio.resume().catch(()=>{});
        } catch(_) {} // Visual static remains available when the TV blocks audio autoplay.
    }
    const screenElement = id => document.getElementById ? document.getElementById(id) : null;
    function stopNoise() {
        tuning = false;
        hiss(false);
        if (noiseFrame !== null)
            cancelAnimationFrame(noiseFrame);
        noiseFrame = null;
        const canvas = screenElement('tuning');
        if (canvas)
            canvas.hidden = true;
    }
    function startNoise() {
        stopNoise();
        tuning = true;
        hiss(true);
        const canvas = screenElement('tuning');
        if (!canvas)
            return;
        canvas.hidden = false;
        canvas.width = 256;
        canvas.height = 192;
        const ctx = canvas.getContext('2d');
        const pixels = ctx.createImageData(256, 192);
        let previous = 0;
        function draw(time) {
            if (!tuning || dead)
                return;
            if (time - previous > 42) {
                previous = time;
                const band = Math.floor(time / 18) % 192;
                for (let i = 0; i < pixels.data.length; i += 4) {
                    const y = Math.floor(i / 4 / 256), shade = Math.abs(y - band) < 2 ? 25 : Math.floor(Math.random() * 210);
                    pixels.data[i] = pixels.data[i + 1] = pixels.data[i + 2] = shade;
                    pixels.data[i + 3] = 255;
                }
                ctx.putImageData(pixels, 0, 0);
            }
            noiseFrame = requestAnimationFrame(draw);
        }
        noiseFrame = requestAnimationFrame(draw);
    }
    function feedback(kind, value, era) {
        if (dead || !['channel', 'volume', 'mute', 'input', 'signal', 'brightness', 'contrast', 'color'].includes(kind))
            return;
        screenEra = Math.max(0, Math.min(5, Number(era) || 0));
        const osd = screenElement('osd');
        if (!osd)
            return;
        document.body.dataset.era = String(screenEra);
        clearTimeout(feedbackTimeout);
        osd.className = 'osd ' + kind;
        osd.hidden = false;
        const label = screenElement('osd-label'), bars = screenElement('osd-bars');
        label.textContent = kind === 'channel' ? 'CH ' + String(value).padStart(2, '0') : kind === 'volume' ? 'VOLUME ' + value : kind === 'mute' ? (value ? 'MUTING' : 'SOUND ON') : kind === 'signal' ? 'NO SIGNAL' : kind in pictureKnobs ? kind.toUpperCase() + ' ' + value : 'INPUT  ' + String(value);
        bars.replaceChildren();
        bars.hidden = kind !== 'volume';
        if (kind === 'volume')
            for (let i = 0; i < 20; i++) {
                const bar = document.createElement('i');
                bar.className = i < Math.round(Number(value) / 5) ? 'lit' : '';
                bars.append(bar);
            }
        if ((kind === 'channel' || kind === 'signal') && wantPlay && !pictureVisible) startNoise();
        feedbackTimeout = setTimeout(() => { osd.hidden = true; }, kind === 'channel' ? 1800 : 2200);
    }
    // Wide side gutters move provider corner overlays outside the tube. The
    // picture is constrained by height so ordinary 4:3 and 16:9 clips remain whole.
    // Cinema fit reserves enough horizontal room for ultrawide material.
    function presentPicture() {
        const iframe = player && player.getIframe && player.getIframe();
        if (!iframe || !iframe.style)
            return;
        // Android WebView can expand the root layout around the wide iframe and
        // report zero body height. Its visual viewport is the actual visible tube.
        const viewport = window.visualViewport;
        const width = viewport && viewport.width || document.body.clientWidth || document.documentElement.clientWidth;
        const height = viewport && viewport.height || document.body.clientHeight || document.documentElement.clientHeight;
        if (width <= 0 || height <= 0)
            return;
        // Cover the glass with the clip's own aspect (4:3 until metadata says otherwise): CRTs add
        // restrained overscan, the flat panel only enough to hide edge seams. The wide provider viewport
        // still keeps its corner controls outside the tube.
        // Picture modes: 0 period (default): a CRT fills its whole tube with overscan, stretching up to 8%
        // toward the glass shape instead of cropping more; the 2000s flat panel shows 4:3 with side bars
        // like an HDTV's "Normal" mode and fills only for widescreen. 1 fill covers the glass whatever the
        // crop. 2 whole picture never crops. Fullscreen always keeps the whole picture.
        const tubeFill = pictureMode === 0 && !flatPanel && !fullscreenPicture;
        // Period material is a 4:3 picture: widescreen uploads usually carry it with baked-in side bars,
        // so a tube fills from the 4:3 core (true widescreen is pan-and-scanned, as broadcast did).
        const sourceRatio = tubeFill ? 4 / 3 : contentRatio;
        const stretch = tubeFill ? Math.max(1 / TUBE_STRETCH, Math.min(TUBE_STRETCH, (width / height) / sourceRatio)) : 1;
        const ratio = sourceRatio * stretch;
        const contain = Math.min(height, width / ratio);
        const cover = Math.max(height, width / ratio) * (flatPanel ? 1.01 : 1.03);
        const pictureHeight = fullscreenPicture || pictureMode === 2 || (pictureMode === 0 && flatPanel) ? contain : cover;
        // Keep the actual provider viewport above its documented minimum even
        // in a small CRT opening; scale the whole viewport uniformly afterwards.
        const playerHeight = Math.max(270, pictureHeight), scale = pictureHeight / playerHeight;
        Object.assign(iframe.style, { position: 'absolute', width: ((width + 2000) / (scale * stretch)) + 'px',
            height: playerHeight + 'px', left: '-1000px', top: ((height - pictureHeight) / 2) + 'px',
            transform: stretch === 1 ? 'scale(' + scale + ')' : 'scale(' + scale * stretch + ',' + scale + ')', transformOrigin: 'top left',
            // Opacity keeps the embedded document rendering while its transport
            // animation fades. visibility:hidden was postponing that animation.
            filter: (pictureKnobs.brightness === 50 && pictureKnobs.contrast === 50 && pictureKnobs.color === 50) ? 'none' : 'brightness(' + (0.5 + pictureKnobs.brightness / 100) + ') contrast(' + (0.5 + pictureKnobs.contrast / 100) + ') saturate(' + (pictureKnobs.color / 50) + ')',
            pointerEvents: 'none', visibility: 'visible', opacity: active && [1, 2, 3].includes(state) && pictureVisible ? '1' : '0' });
    }
    window.addEventListener('resize', presentPicture);
    if (window.visualViewport)
        window.visualViewport.addEventListener('resize', presentPicture);
    // freshStart: an explicit play/restart, whose provider animation needs its own full window.
    function armPictureReveal(freshStart) {
        clearTimeout(revealTimeout);
        pictureVisible = false;
        if (freshStart || firstPlayAt < 0)
            firstPlayAt = clock();
        const generation = ++revealGeneration, tunedRevision = revision;
        let lastTime = player.getCurrentTime ? player.getCurrentTime() : 0;
        const remaining = () => REVEAL_WINDOW - (clock() - firstPlayAt);
        function revealWhenMoving() {
            if (dead || !active || state !== 1 || generation !== revealGeneration || tunedRevision !== revision)
                return;
            if (remaining() > 0) {
                revealTimeout = setTimeout(revealWhenMoving, remaining());
                return;
            }
            // Time must advance from where this arm began (after any seek), so a buffering spinner stays covered.
            const now = player.getCurrentTime ? player.getCurrentTime() : lastTime + 1;
            if (now > lastTime + .05) {
                pictureVisible = true;
                ++startGeneration;
                clearTimeout(startTimer);
                if (!revealMs)
                    revealMs = Math.round(clock() - tunedAt);
                stopNoise();
                presentPicture();
            }
            else {
                lastTime = now;
                revealTimeout = setTimeout(revealWhenMoving, 200);
            }
        }
        revealTimeout = setTimeout(revealWhenMoving, Math.max(200, remaining()));
        presentPicture();
    }
    // A start that never reaches a moving picture, or playback stuck buffering, is reported with
    // negative codes so native code can skip it without mistaking it for a removed video.
    function signalLost(code) {
        if (dead || !active || error)
            return;
        error = code;
        wantPlay = false;
        stopNoise();
        pictureVisible = false;
        ++startGeneration;
        ++stallGeneration;
        clearTimeout(startTimer);
        clearTimeout(stallTimer);
        clearTimeout(revealTimeout);
        ++revealGeneration;
        presentPicture();
        feedback('signal', code, screenEra);
        try {
            if (player && player.pauseVideo)
                player.pauseVideo();
        }
        catch (_) { }
    }
    function watchStart() {
        clearTimeout(startTimer);
        const generation = ++startGeneration, tunedRevision = revision;
        startTimer = setTimeout(() => {
            if (generation === startGeneration && tunedRevision === revision && wantPlay && !pictureVisible && !blocked)
                signalLost(-2);
        }, START_LIMIT);
    }
    function watchStall() {
        clearTimeout(stallTimer);
        const generation = ++stallGeneration, tunedRevision = revision;
        stallTimer = setTimeout(() => {
            if (generation === stallGeneration && tunedRevision === revision && wantPlay && state === 3)
                signalLost(-3);
        }, STALL_LIMIT);
    }
    function applyCaptions() {
        if (dead || !ready || !player || applyingCaptions || !player.setOption)
            return;
        applyingCaptions = true;
        try {
            if (!captions) {
                // Clear the selected track, including an inherited YouTube caption preference.
                player.setOption('captions', 'track', {});
                captionStatus = 'off';
            }
            else {
                const tracks = player.getOption ? player.getOption('captions', 'tracklist') : [];
                if (Array.isArray(tracks) && tracks.length) {
                    const track = tracks.find(t => t.languageCode === 'en') || tracks[0];
                    player.setOption('captions', 'track', track);
                    captionStatus = 'on';
                }
                else {
                    // Some player versions do not expose tracklist after clearing the track.
                    // Request an English track and let the module report the actual selection.
                    player.setOption('captions', 'track', { languageCode: 'en' });
                    const selected = player.getOption && player.getOption('captions', 'track');
                    // Selection can complete asynchronously; lack of an immediate result
                    // does not mean the clip has no captions.
                    captionStatus = selected && selected.languageCode ? 'on' : 'requested';
                    if (player.loadModule && captionLoadId !== currentId) {
                        captionLoadId = currentId;
                        player.loadModule('captions');
                    }
                }
            }
        }
        catch (_) {
            captionStatus = captions ? 'requested' : 'off';
        }
        finally {
            applyingCaptions = false;
        }
    }
    const validId = id => typeof id === 'string' && /^[A-Za-z0-9_-]{11}$/.test(id);
    function videoMatches() {
        const data = player && player.getVideoData ? player.getVideoData() : null;
        return data && data.video_id === currentId;
    }
    function errorMatches() {
        const data = player && player.getVideoData ? player.getVideoData() : null;
        return !data || !data.video_id || data.video_id === currentId;
    }
    function apply() {
        if (dead || !ready || !pending || !active)
            return;
        const request = pending;
        pending = null;
        const knownDuration = durations.get(request.id);
        const joinedStart = request.random && knownDuration > 5 ? Math.floor(Math.random() * (knownDuration - 5)) : request.start;
        randomStart = request.random && !(knownDuration > 5);
        wantPlay = request.play;
        player.setVolume(volume);
        player[request.play ? 'loadVideoById' : 'cueVideoById']({ videoId: request.id, startSeconds: joinedStart });
        if (request.play)
            watchStart();
    }
    function startApi() {
        if (apiStarted || dead)
            return;
        apiStarted = true;
        timeout = setTimeout(() => { if (!ready && !dead) {error = -1;stopNoise();} }, 20000);
        const script = document.createElement('script');
        script.src = 'https://www.youtube.com/iframe_api';
        script.onerror = () => { if (!dead) {error = -1;stopNoise();} };
        document.head.appendChild(script);
    }
    window.onYouTubeIframeAPIReady = function () {
        if (dead)
            return;
        player = new YT.Player('player', {
            width: '100%', height: '100%',
            // controls=0 hides the transport bar, not YouTube's hover/title/branding UI.
            playerVars: { autoplay: 0, controls: 0, disablekb: 1, playsinline: 1, fs: 0, iv_load_policy: 3, cc_load_policy: 0, origin: location.origin },
            events: {
                onReady: () => { if (dead)
                    return; clearTimeout(timeout); ready = true; error = 0; apply(); applyCaptions(); presentPicture(); },
                onApiChange: applyCaptions,
                onStateChange: event => {
                    if (dead || !active || !videoMatches())
                        return;
                    // A stale end event for a retuned copy of the same video must not skip it.
                    if (event.data === 0 && !started)
                        return;
                    state = event.data;
                    clearTimeout(revealTimeout);
                    ++revealGeneration;
                    if (![1, 2, 3].includes(state))
                        pictureVisible = false;
                    if (state === 3 && pictureVisible && wantPlay)
                        watchStall();
                    else if (state !== 3) {
                        ++stallGeneration;
                        clearTimeout(stallTimer);
                    }
                    if (state === 1 && !pictureVisible) {
                        // Let the provider's central transport animation finish before
                        // revealing the tube, including when resuming from pause.
                        armPictureReveal();
                    }
                    presentPicture();
                    if (state === 1) {
                        if (!firstPlayMs) firstPlayMs = Math.round(clock() - tunedAt);
                        const knownDuration = player.getDuration && player.getDuration();
                        if (knownDuration > 5) {durations.delete(currentId);durations.set(currentId,knownDuration);if(durations.size>128)durations.delete(durations.keys().next().value);}
                        started = true;
                        blocked = false;
                        error = 0;
                        applyCaptions();
                        if (randomStart && player.getDuration) {
                            const duration = player.getDuration();
                            if (Number.isFinite(duration) && duration > 5) {
                                randomStart = false;
                                player.seekTo(Math.floor(Math.random() * (duration - 5)), true);
                                // Motion must be measured from the new position; the window keeps its original start.
                                if (!pictureVisible)
                                    armPictureReveal();
                            }
                        }
                    }
                },
                onError: event => { if (!dead && active && errorMatches()) {
                    error = event.data;
                    wantPlay = false;
                    stopNoise();
                    pictureVisible = false;
                    ++startGeneration;
                    ++stallGeneration;
                    clearTimeout(startTimer);
                    clearTimeout(stallTimer);
                    presentPicture();
                    feedback('signal', error, screenEra);
                } },
                onAutoplayBlocked: () => { if (!dead && active) {blocked = true;stopNoise();} }
            }
        });
    };
    window.retro = {
        feedback,
        tune(id, play, nextRevision, startSeconds = 0, joinAtRandom = false) {
            if (dead || !validId(id) || !Number.isInteger(nextRevision) || nextRevision < revision)
                return false;
            // Re-sending the same revision after HTML load is harmless, never restarts playback.
            if (nextRevision === revision && currentId === id)
                return true;
            revision = nextRevision;
            currentId = id;
            state = -1;
            error = 0;
            blocked = false;
            active = true;
            started = false;
            tunedAt = clock();
            revealMs = 0;
            firstPlayMs = 0;
            firstPlayAt = -1;
            wantPlay = play === true;
            if (wantPlay) startNoise(); else stopNoise();
            ++startGeneration;
            ++stallGeneration;
            clearTimeout(startTimer);
            clearTimeout(stallTimer);
            randomStart = false;
            clearTimeout(revealTimeout);
            ++revealGeneration;
            pictureVisible = false;
            presentPicture();
            captionLoadId = '';
            captionStatus = captions ? 'loading' : 'off';
            pending = { id, play: play === true, start: Number.isFinite(startSeconds) ? Math.max(0, Math.min(86400, startSeconds)) : 0, random: joinAtRandom === true };
            startApi();
            apply();
            return true;
        },
        control(action, value) {
            if (dead)
                return;
            if (action in pictureKnobs) {
                pictureKnobs[action] = Math.max(0, Math.min(100, Number(value) || 0));
                presentPicture();
                return;
            }
            if (action === 'screen') {
                fullscreenPicture = value >= 10;
                flatPanel = value % 10 === 5;
                tubeRatio = value >= 10 || value === 5 ? 16 / 9 : 4 / 3;
                pictureRatio = tubeRatio;
                presentPicture();
                return;
            }
            if (action === 'aspect') {
                const ratio = Number(value) / 100;
                contentRatio = ratio >= 1 && ratio <= 2.5 ? ratio : 4 / 3;
                presentPicture();
                return;
            }
            if (action === 'picture') {
                pictureMode = [0, 1, 2].includes(value) ? value : 0;
                presentPicture();
                return;
            }
            if (action === 'captions') {
                captions = value === 1;
                captionStatus = captions ? 'loading' : 'off';
                applyCaptions();
                return;
            }
            if (action === 'volume')
                volume = Math.max(0, Math.min(100, Number(value) || 0));
            if (action === 'play' || action === 'restart') {wantPlay = true;if(!pictureVisible)startNoise();}
            if (action === 'pause' || action === 'stop') {
                wantPlay = false;
                stopNoise();
                ++startGeneration;
                ++stallGeneration;
                clearTimeout(startTimer);
                clearTimeout(stallTimer);
            }
            if (!ready) {
                if (pending && action === 'pause')
                    pending.play = false;
                if (pending && action === 'play')
                    pending.play = true;
                if (action === 'stop') {
                    active = false;
                    pending = null;
                }
                return;
            }
            switch (action) {
                case 'play':
                    active = true;
                    error = 0;
                    watchStart();
                    armPictureReveal(true);
                    player.playVideo();
                    break;
                case 'pause':
                    if (pending)
                        pending.play = false;
                    player.pauseVideo();
                    break;
                case 'volume':
                    volume = Math.max(0, Math.min(100, Number(value) || 0));
                    player.setVolume(volume);
                    if(tuning)hiss(true);
                    break;
                case 'restart':
                    error = 0;
                    watchStart();
                    armPictureReveal(true);
                    player.seekTo(0, true);
                    player.playVideo();
                    break;
                case 'stop':
                    active = false;
                    pending = null;
                    state = -1;
                    player.stopVideo();
                    break;
            }
        },
        snapshot() {
            return { ready, revision, id: currentId, state, error, blocked, captions, captionStatus, pictureRatio, pictureVisible, revealMs, firstPlayMs, tuning,
                time: ready && player.getCurrentTime ? player.getCurrentTime() : 0,
                duration: ready && player.getDuration ? player.getDuration() : 0 };
        },
        destroy() {
            if (dead)
                return;
            dead = true;
            active = false;
            ready = false;
            pending = null;
            clearTimeout(timeout);
            clearTimeout(revealTimeout);
            clearTimeout(feedbackTimeout);
            clearTimeout(startTimer);
            clearTimeout(stallTimer);
            stopNoise();
            if(noiseAudio){noiseSource.stop();noiseAudio.close().catch(()=>{});noiseAudio=null;}
            if (player) {
                player.stopVideo();
                player.destroy();
                player = null;
            }
        }
    };
    document.addEventListener('visibilitychange', () => {
        if (document.hidden && player && ready && !dead) {
            wantPlay = false;
            stopNoise();
            ++startGeneration;
            ++stallGeneration;
            player.pauseVideo();
            state = 2;
            presentPicture();
        }
    });
    window.addEventListener('pagehide', () => window.retro.destroy());
    startApi(); // Warm the provider while the TV console and catalog are being prepared.
})();
