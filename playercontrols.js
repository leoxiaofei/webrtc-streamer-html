var PlayerControls = (function() {

/**
 * Format a time in seconds as [h:]mm:ss
 * @param {number} time - time in seconds
*/
function formatTime(time) {
	if (!isFinite(time) || (time < 0)) {
		time = 0;
	}
	let hours   = Math.floor(time / 3600);
	let minutes = Math.floor((time % 3600) / 60);
	let seconds = Math.floor(time % 60);
	return (hours ? (hours + ":" + String(minutes).padStart(2, "0")) : minutes) + ":" + String(seconds).padStart(2, "0");
}

/**
 * Create playback controls (progress bar and speed buttons) attached to a WebRtcStreamer instance.
 * The controls poll the playback state of the stream and send seek/speed commands
 * on the WebRTC data channel. Nothing is displayed for streams that do not
 * answer playback state (live streams without seek support show only speed buttons).
 *
 * @param {HTMLElement} container - element the controls are appended to
 * @param {object} webRtcServer  - a WebRtcStreamer instance
 * @param {object} options       - { rates: array of speed values, pollMs: polling period, compact: reduce layout }
 * @returns {object} controls instance with a dispose() method
*/
function create(container, webRtcServer, options) {
	let opts = Object.assign( { rates: [0.5, 1, 2, 4, 8], pollMs: 1000, compact: false }, options);

	// build the controls
	let root = document.createElement("div");
	root.className = "playercontrols" + (opts.compact ? " compact" : "");
	root.style.display = "none";

	let playPause = document.createElement("button");
	playPause.className = "pc-pause";
	playPause.innerText = "暂停";
	playPause.title = "暂停 / 继续";
	playPause.onclick = () => {
		if (state.paused) {
			webRtcServer.resume();
		}
		else {
			webRtcServer.pause();
		}
	};

	let seekBar = document.createElement("input");
	seekBar.type = "range";
	seekBar.className = "pc-seek";
	seekBar.min = 0;
	seekBar.max = 100;
	seekBar.step = 0.1;
	seekBar.value = 0;

	let timeLabel = document.createElement("span");
	timeLabel.className = "pc-time";
	timeLabel.innerText = "00:00 / 00:00";

	let ratesElt = document.createElement("span");
	ratesElt.className = "pc-rates";
	let rateButtons = [];

	// build the speed buttons (default rates, or the rates supported by the server
	// when they are advertised in the playback state)
	function buildRates(rates) {
		ratesElt.innerHTML = "";
		rateButtons = [];
		for (let rate of rates) {
			let button = document.createElement("button");
			button.className = "pc-rate";
			button.innerText = rate + "x";
			button.onclick = () => webRtcServer.setRate(rate);
			ratesElt.appendChild(button);
			rateButtons.push( { rate: rate, button: button } );
		}
	}
	buildRates(opts.rates);

	root.appendChild(playPause);
	root.appendChild(seekBar);
	root.appendChild(timeLabel);
	root.appendChild(ratesElt);
	container.appendChild(root);

	// state
	let state = {
		duration: 0,
		position: 0,
		scale: 1,
		seekable: false,
		paused: false,
		dragging: false,
		ratesKey: opts.rates.join(",")
	};

	// send a seek request when the bar is released
	seekBar.oninput = () => {
		state.dragging = true;
		timeLabel.innerText = formatTime(seekBar.value) + " / " + formatTime(state.duration);
	};
	seekBar.onchange = () => {
		webRtcServer.seek(parseFloat(seekBar.value));
		state.dragging = false;
	};

	// refresh the controls with a playback state answer
	function update(progress) {
		if (progress.error || !progress.seekable) {
			// the stream does not support playback control (e.g. a live stream)
			root.style.display = "none";
			return;
		}
		root.style.display = "";

		state.duration = progress.duration || 0;
		state.scale = progress.scale || 1;
		state.paused = !!progress.paused;
		state.seekable = progress.seekable && (state.duration > 0);
		playPause.innerText = state.paused ? "继续" : "暂停";

		// use the playback speeds supported by the server when advertised
		if (Array.isArray(progress.scales) && progress.scales.length) {
			let key = progress.scales.join(",");
			if (key !== state.ratesKey) {
				state.ratesKey = key;
				buildRates(progress.scales);
			}
		}

		seekBar.style.display = state.seekable ? "" : "none";

		if (!state.dragging) {
			// do not touch the seek bar attributes while dragging:
			// resetting them cancels the drag and the change event in some browsers
			if (Number(seekBar.max) !== state.duration) {
				seekBar.max = state.duration;
			}
			state.position = Math.min(progress.position || 0, state.duration);
			seekBar.value = state.position;
			timeLabel.innerText = formatTime(state.position) + " / " + formatTime(state.duration);
		}

		// highlight the active speed
		for (let item of rateButtons) {
			let active = Math.abs(item.rate - state.scale) < 0.01;
			item.button.className = "pc-rate" + (active ? " active" : "");
		}
	}

	// poll the playback state using the control data channel,
	// stop when the connection is closed
	let timer = setInterval( () => {
		if (webRtcServer.pc === null) {
			dispose();
			return;
		}
		webRtcServer.getProgress();
	}, opts.pollMs);

	webRtcServer.onProgress = update;

	function dispose() {
		clearInterval(timer);
		root.remove();
	}

	return { dispose: dispose, update: update };
}

return { create: create, formatTime: formatTime };

})();

if (typeof window !== 'undefined' && typeof window.document !== 'undefined') {
	window.PlayerControls = PlayerControls;
}
if (typeof module !== 'undefined' && typeof module.exports !== 'undefined') {
	module.exports = PlayerControls;
}
