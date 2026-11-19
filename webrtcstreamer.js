var WebRtcStreamer = (function() {

/** 
 * Interface with WebRTC-streamer API
 * @constructor
 * @param {string} videoElement - id of the video element tag
 * @param {string} srvurl -  url of webrtc-streamer (default is current location)
*/
var WebRtcStreamer = function WebRtcStreamer (videoElement, srvurl) {
	if (typeof videoElement === "string") {
		this.videoElement = document.getElementById(videoElement);
	} else {
		this.videoElement = videoElement;
	}
	this.srvurl           = srvurl || location.protocol+"//"+window.location.hostname+":"+window.location.port;
	this.pc               = null;
	this.controlChannel   = null;

	// callback answering playback state changes, set with setRate/seek/getProgress
	this.onProgress       = null;

	this.mediaConstraints = { offerToReceiveAudio: true, offerToReceiveVideo: true };

	this.iceServers = null;
	this.earlyCandidates = [];
}

WebRtcStreamer.prototype._handleHttpErrors = function (response) {
    if (!response.ok) {
        throw Error(response.statusText);
    }
    return response;
}

/**
 * The parameters of a stream url following its '?' are split by the browser
 * as page parameters (the '&' of the stream url is a page parameter separator),
 * reassemble the page parameters that are missing from the stream url
 * @param {string} url - url of the stream
*/
WebRtcStreamer.reassembleUrlParams = function(url) {
	if (url && (url.indexOf("?") > 0) && (typeof URLSearchParams != 'undefined')) {
		let pageParams = new URLSearchParams(location.search);
		["starttime", "endtime", "ntptime", "name", "size"].forEach( (param) => {
			if ( pageParams.has(param) && (url.indexOf(param + "=") < 0) ) {
				url += "&" + param + "=" + pageParams.get(param);
			}
		} );
	}
	return url;
}

/**
 * Connect a WebRTC Stream to videoElement
 * @param {string} videourl - id of WebRTC video stream
 * @param {string} audiourl - id of WebRTC audio stream
 * @param {string} options  -  options of WebRTC call
 * @param {string} stream   -  local stream to send
 * @param {string} prefmime -  prefered mime
*/
WebRtcStreamer.prototype.connect = function(videourl, audiourl, options, localstream, prefmime) {
	this.disconnect();

	// reassemble the stream url parameters split by the browser as page parameters
	videourl = WebRtcStreamer.reassembleUrlParams(videourl);
	audiourl = WebRtcStreamer.reassembleUrlParams(audiourl);

	// getIceServers is not already received
	if (!this.iceServers) {
		console.log("Get IceServers");
		
		fetch(this.srvurl + "/api/getIceServers")
			.then(this._handleHttpErrors)
			.then( (response) => (response.json()) )
			.then( (response) =>  this.onReceiveGetIceServers(response, videourl, audiourl, options, localstream, prefmime))
			.catch( (error) => this.onError("getIceServers " + error ))
				
	} else {
		this.onReceiveGetIceServers(this.iceServers, videourl, audiourl, options, localstream, prefmime);
	}
}

/** 
 * Disconnect a WebRTC Stream and clear videoElement source
*/
WebRtcStreamer.prototype.disconnect = function() {		
	if (this.videoElement?.srcObject) {
		this.videoElement.srcObject.getTracks().forEach(track => {
			track.stop()
			this.videoElement.srcObject.removeTrack(track);
		});
	}
	if (this.pc) {
		fetch(this.srvurl + "/api/hangup?peerid=" + this.pc.peerid)
			.then(this._handleHttpErrors)
			.catch( (error) => this.onError("hangup " + error ))

		
		try {
			this.pc.close();
		}
		catch (e) {
			console.log ("Failure close peer connection:" + e);
		}
		this.pc = null;
		this.controlChannel = null;
	}
}

/**
 * Send a playback control command on the data channel
 * @param {string} cmd    - command: speed, seek, progress
 * @param {number} value  - value of the command
*/
WebRtcStreamer.prototype.sendCommand = function(cmd, value) {
	if (this.controlChannel && this.controlChannel.readyState === "open") {
		let command = { cmd: cmd };
		if (value !== undefined) {
			command.value = value;
		}
		this.controlChannel.send(JSON.stringify(command));
		return true;
	}
	console.log("control channel is not open, cannot send " + cmd);
	return false;
}

/**
 * Change the playback speed (e.g. 0.5, 2, 4)
 * The command is sent on the data channel, falling back to the HTTP API
 * @param {number} rate - playback speed
*/
WebRtcStreamer.prototype.setRate = function(rate) {
	if (this.sendCommand("speed", rate)) {
		return true;
	}
	if (this.pc) {
		fetch(this.srvurl + "/api/speed?peerid=" + this.pc.peerid + "&rate=" + rate)
			.then(this._handleHttpErrors)
			.then( (response) => (response.json()) )
			.then( (response) => { if (this.onProgress) this.onProgress(response); } )
			.catch( (error) => this.onError("speed " + error) );
		return true;
	}
	return false;
}

/**
 * Seek to a position in seconds
 * The command is sent on the data channel, falling back to the HTTP API
 * @param {number} time - position in seconds from the beginning of the stream
*/
WebRtcStreamer.prototype.seek = function(time) {
	if (this.sendCommand("seek", time)) {
		return true;
	}
	if (this.pc) {
		fetch(this.srvurl + "/api/seek?peerid=" + this.pc.peerid + "&time=" + time)
			.then(this._handleHttpErrors)
			.then( (response) => (response.json()) )
			.then( (response) => { if (this.onProgress) this.onProgress(response); } )
			.catch( (error) => this.onError("seek " + error) );
		return true;
	}
	return false;
}

/**
 * Pause the stream
 * The command is sent on the data channel, falling back to the HTTP API
*/
WebRtcStreamer.prototype.pause = function() {
	if (this.sendCommand("pause")) {
		return true;
	}
	if (this.pc) {
		fetch(this.srvurl + "/api/pause?peerid=" + this.pc.peerid)
			.then(this._handleHttpErrors)
			.then( (response) => (response.json()) )
			.then( (response) => { if (this.onProgress) this.onProgress(response); } )
			.catch( (error) => this.onError("pause " + error) );
		return true;
	}
	return false;
}

/**
 * Resume a paused stream
 * The command is sent on the data channel, falling back to the HTTP API
*/
WebRtcStreamer.prototype.resume = function() {
	if (this.sendCommand("resume")) {
		return true;
	}
	if (this.pc) {
		fetch(this.srvurl + "/api/resume?peerid=" + this.pc.peerid)
			.then(this._handleHttpErrors)
			.then( (response) => (response.json()) )
			.then( (response) => { if (this.onProgress) this.onProgress(response); } )
			.catch( (error) => this.onError("resume " + error) );
		return true;
	}
	return false;
}

/**
 * Request the playback state, the answer is delivered to the onProgress callback
 * The command is sent on the data channel, falling back to the HTTP API
*/
WebRtcStreamer.prototype.getProgress = function() {
	if (this.sendCommand("progress")) {
		return true;
	}
	if (this.pc) {
		fetch(this.srvurl + "/api/progress?peerid=" + this.pc.peerid)
			.then(this._handleHttpErrors)
			.then( (response) => (response.json()) )
			.then( (response) => { if (this.onProgress) this.onProgress(response); } )
			.catch( (error) => this.onError("progress " + error) );
		return true;
	}
	return false;
}

/*
* Control datachannel callback answering playback state (json) or text message
*/
WebRtcStreamer.prototype.onControlMessage = function(event) {
	try {
		let msg = JSON.parse(event.data);
		if ( (typeof msg === "object") && (msg !== null) ) {
			if (this.onProgress) {
				this.onProgress(msg);
			}
			return;
		}
	} catch (e) { }
	console.log("control channel recv:"+JSON.stringify(event.data));
}

WebRtcStreamer.prototype.filterPreferredCodec = function(sdp, prefmime) {
    const lines = sdp.split('\n');
    const [prefkind, prefcodec] = prefmime.toLowerCase().split('/');
    let currentMediaType = null;
    let sdpSections = [];
    let currentSection = [];

    // Group lines into sections
    lines.forEach(line => {
        if (line.startsWith('m=')) {
            if (currentSection.length) {
                sdpSections.push(currentSection);
            }
            currentSection = [line];
        } else {
            currentSection.push(line);
        }
    });
    sdpSections.push(currentSection);

    // Process each section
    const processedSections = sdpSections.map(section => {
        const firstLine = section[0];
        if (!firstLine.startsWith('m=' + prefkind)) {
            return section.join('\n');
        }

        // Get payload types for preferred codec
        const rtpLines = section.filter(line => line.startsWith('a=rtpmap:'));
        const preferredPayloads = rtpLines
            .filter(line => line.toLowerCase().includes(prefcodec))
            .map(line => line.split(':')[1].split(' ')[0]);

        if (preferredPayloads.length === 0) {
            return section.join('\n');
        }

        // Modify m= line to only include preferred payloads
        const mLine = firstLine.split(' ');
        const newMLine = [...mLine.slice(0,3), ...preferredPayloads].join(' ');

        // Filter related attributes
        const filteredLines = section.filter(line => {
            if (line === firstLine) return false;
            if (line.startsWith('a=rtpmap:')) {
                return preferredPayloads.some(payload => line.startsWith(`a=rtpmap:${payload}`));
            }
            if (line.startsWith('a=fmtp:') || line.startsWith('a=rtcp-fb:')) {
                return preferredPayloads.some(payload => line.startsWith(`a=${line.split(':')[0].split('a=')[1]}:${payload}`));
            }
            return true;
        });

        return [newMLine, ...filteredLines].join('\n');
    });

    return processedSections.join('\n');
}

/*
* GetIceServers callback
*/
WebRtcStreamer.prototype.onReceiveGetIceServers = function(iceServers, videourl, audiourl, options, stream, prefmime) {
	this.iceServers       = iceServers;
	this.pcConfig         = iceServers || {"iceServers": [] };
	try {            
		this.createPeerConnection();

		let callurl = this.srvurl + "/api/call?peerid=" + this.pc.peerid + "&url=" + encodeURIComponent(videourl);
		if (audiourl) {
			callurl += "&audiourl="+encodeURIComponent(audiourl);
		}
		if (options) {
			callurl += "&options="+encodeURIComponent(options);
		}
		
		if (stream) {
			this.pc.addStream(stream);
		}

                // clear early candidates
		this.earlyCandidates.length = 0;	
	
		// create Offer
		this.pc.createOffer(this.mediaConstraints).then((sessionDescription) => {
			console.log("Create offer:" + JSON.stringify(sessionDescription));

			console.log(`video codecs:${Array.from(new Set(RTCRtpReceiver.getCapabilities("video")?.codecs?.map(codec => codec.mimeType)))}`)
			console.log(`audio codecs:${Array.from(new Set(RTCRtpReceiver.getCapabilities("audio")?.codecs?.map(codec => codec.mimeType)))}`)
	
			if (prefmime != undefined) {
				//set prefered codec
				let [prefkind] = prefmime.split('/');
				if (prefkind != "video" && prefkind != "audio") {
					prefkind = "video";
					prefmime = prefkind + "/" + prefmime;
				}
				console.log("sdp:" + sessionDescription.sdp);
				sessionDescription.sdp = this.filterPreferredCodec(sessionDescription.sdp, prefmime);
				console.log("sdp:" + sessionDescription.sdp);
			}
	
			
			this.pc.setLocalDescription(sessionDescription)
				.then(() => {
					fetch(callurl, { method: "POST", body: JSON.stringify(sessionDescription) })
						.then(this._handleHttpErrors)
						.then( (response) => (response.json()) )
						.catch( (error) => this.onError("call " + error ))
						.then( (response) =>  this.onReceiveCall(response) )
						.catch( (error) => this.onError("call " + error ))
				
				}, (error) => {
					console.log ("setLocalDescription error:" + JSON.stringify(error)); 
				});
			
		}, (error) => { 
			alert("Create offer error:" + JSON.stringify(error));
		});

	} catch (e) {
		this.disconnect();
		alert("connect error: " + e);
	}	    
}


WebRtcStreamer.prototype.getIceCandidate = function() {
	fetch(this.srvurl + "/api/getIceCandidate?peerid=" + this.pc.peerid)
		.then(this._handleHttpErrors)
		.then( (response) => (response.json()) )
		.then( (response) =>  this.onReceiveCandidate(response))
		.catch( (error) => this.onError("getIceCandidate " + error ))
}
					
/*
* create RTCPeerConnection 
*/
WebRtcStreamer.prototype.createPeerConnection = function() {
	console.log("createPeerConnection  config: " + JSON.stringify(this.pcConfig));
	this.pc = new RTCPeerConnection(this.pcConfig);
	let pc = this.pc;
	pc.peerid = Math.random();			
	
	pc.onicecandidate = (evt) => this.onIceCandidate(evt);
	pc.onaddstream    = (evt) => this.onAddStream(evt);
	pc.oniceconnectionstatechange = (evt) => {  
		console.log("oniceconnectionstatechange  state: " + pc.iceConnectionState);
		if (this.videoElement) {
			if (pc.iceConnectionState === "connected") {
				this.videoElement.style.opacity = "1.0";
			}			
			else if (pc.iceConnectionState === "disconnected") {
				this.videoElement.style.opacity = "0.25";
			}			
			else if ( (pc.iceConnectionState === "failed") || (pc.iceConnectionState === "closed") )  {
				this.videoElement.style.opacity = "0.5";
			} else if (pc.iceConnectionState === "new") {
				this.getIceCandidate();
			}
		}
	}
	pc.ondatachannel = (evt) => {
		console.log("remote datachannel created:"+JSON.stringify(evt));

		// use the channel created by the server as control channel (playback commands)
		this.controlChannel = evt.channel;
		evt.channel.onopen = function () {
			console.log("remote datachannel open");
			this.send("remote channel openned");
		}
		evt.channel.onmessage = (event) => this.onControlMessage(event);
	}

	try {
		let dataChannel = pc.createDataChannel("ClientDataChannel");
		dataChannel.onopen = function() {
			console.log("local datachannel open");
			this.send("local channel openned");
		}
		dataChannel.onmessage = function(evt) {
			console.log("local datachannel recv:"+JSON.stringify(evt.data));
		}
	} catch (e) {
		console.log("Cannor create datachannel error: " + e);
	}	
	
	console.log("Created RTCPeerConnnection with config: " + JSON.stringify(this.pcConfig) );
	return pc;
}


/*
* RTCPeerConnection IceCandidate callback
*/
WebRtcStreamer.prototype.onIceCandidate = function (event) {
	if (event.candidate) {
		if (this.pc.currentRemoteDescription)  {
			this.addIceCandidate(this.pc.peerid, event.candidate);					
		} else {
			this.earlyCandidates.push(event.candidate);
		}
	} 
	else {
		console.log("End of candidates.");
	}
}


WebRtcStreamer.prototype.addIceCandidate = function(peerid, candidate) {
	fetch(this.srvurl + "/api/addIceCandidate?peerid="+peerid, { method: "POST", body: JSON.stringify(candidate) })
		.then(this._handleHttpErrors)
		.then( (response) => (response.json()) )
		.then( (response) =>  {console.log("addIceCandidate ok:" + response)})
		.catch( (error) => this.onError("addIceCandidate " + error ))
}
				
/*
* RTCPeerConnection AddTrack callback
*/
WebRtcStreamer.prototype.onAddStream = function(event) {
	console.log("Remote track added:" +  JSON.stringify(event));
	
	this.videoElement.srcObject = event.stream;
	let promise = this.videoElement.play();
	if (promise !== undefined) {
	  promise.catch((error) => {
		console.warn("error:"+error);
		this.videoElement.setAttribute("controls", true);
	  });
	}
}
		
/*
* AJAX /call callback
*/
WebRtcStreamer.prototype.onReceiveCall = function(dataJson) {

	console.log("offer: " + JSON.stringify(dataJson));
	let descr = new RTCSessionDescription(dataJson);
	this.pc.setRemoteDescription(descr).then(() =>  { 
			console.log ("setRemoteDescription ok");
			while (this.earlyCandidates.length) {
				let candidate = this.earlyCandidates.shift();
				this.addIceCandidate(this.pc.peerid, candidate);				
			}
		
			this.getIceCandidate()
		}
		, (error) => { 
			console.log ("setRemoteDescription error:" + JSON.stringify(error)); 
		});
}	

/*
* AJAX /getIceCandidate callback
*/
WebRtcStreamer.prototype.onReceiveCandidate = function(dataJson) {
	console.log("candidate: " + JSON.stringify(dataJson));
	if (dataJson) {
		for (let i=0; i<dataJson.length; i++) {
			let candidate = new RTCIceCandidate(dataJson[i]);
			
			console.log("Adding ICE candidate :" + JSON.stringify(candidate) );
			this.pc.addIceCandidate(candidate).then( () =>      { console.log ("addIceCandidate OK"); }
				, (error) => { console.log ("addIceCandidate error:" + JSON.stringify(error)); } );
		}
		this.pc.addIceCandidate();
	}
}


/*
* AJAX callback for Error
*/
WebRtcStreamer.prototype.onError = function(status) {
	console.log("onError:" + status);
}

return WebRtcStreamer;
})();

if (typeof window !== 'undefined' && typeof window.document !== 'undefined') {
	window.WebRtcStreamer = WebRtcStreamer;
}
if (typeof module !== 'undefined' && typeof module.exports !== 'undefined') {
	module.exports = WebRtcStreamer;
}
