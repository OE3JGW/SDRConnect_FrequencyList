'use strict';

/** SDRconnect WebSocket client (API 1.0.3 / SDRconnect >= 1.0.6). */
(function (global) {
  const RECONNECT_MIN_MS = 1000;
  const RECONNECT_MAX_MS = 10000;
  const RETUNE_SETTLE_MS = 120;

  const WATCHED = [
    'api_version',
    'device_center_frequency',
    'device_sample_rate',
    'device_vfo_frequency',
    'demodulator',
    'filter_bandwidth',
    'valid_devices',
    'active_device'
  ];

  class SdrConnectClient {
    constructor({ onStatus = () => {}, onProperty = () => {} } = {}) {
      this.onStatus = onStatus;
      this.onProperty = onProperty;
      this.socket = null;
      this.settings = { host: '127.0.0.1', port: 5454, device: 'primary' };
      this.properties = {};
      this.status = 'disconnected';
      this.attempt = 0;
      this.reconnectTimer = null;
      this.stopped = true;
    }

    get connected() {
      return this.socket !== null && this.socket.readyState === WebSocket.OPEN;
    }

    configure({ host, port, device }) {
      const changed = host !== this.settings.host || Number(port) !== Number(this.settings.port);
      this.settings = {
        host: host || '127.0.0.1',
        port: Number(port) || 5454,
        device: device || 'primary'
      };
      if (changed && !this.stopped) {
        this.attempt = 0;
        this.#closeSocket();
        this.connect();
      }
    }

    start(delayMs = 0) {
      this.stopped = false;
      clearTimeout(this.reconnectTimer);
      if (delayMs > 0) {
        this.#setStatus('connecting');
        this.reconnectTimer = setTimeout(() => this.connect(), delayMs);
      } else {
        this.connect();
      }
    }

    stop() {
      this.stopped = true;
      clearTimeout(this.reconnectTimer);
      this.#closeSocket();
      this.#setStatus('disconnected');
    }

    connect() {
      if (this.stopped || this.connected) return;
      this.#closeSocket();
      this.#setStatus('connecting');

      const url = `ws://${this.settings.host}:${this.settings.port}/`;
      let socket;
      try {
        socket = new WebSocket(url);
      } catch {
        this.#scheduleReconnect();
        return;
      }
      this.socket = socket;
      socket.binaryType = 'arraybuffer';

      socket.addEventListener('open', () => {
        this.attempt = 0;
        this.#setStatus('connected');
        WATCHED.forEach((property) => this.getProperty(property));
      });

      socket.addEventListener('message', (event) => {
        if (typeof event.data !== 'string') return;
        this.#handleMessage(event.data);
      });

      socket.addEventListener('close', () => {
        if (socket.discarded) return;
        if (this.socket === socket) this.socket = null;
        this.properties = {};
        this.#setStatus('disconnected');
        this.#scheduleReconnect();
      });

      socket.addEventListener('error', () => {});
    }

    getProperty(property) {
      this.#send({ event_type: 'get_property', property, value: '' });
    }

    setProperty(property, value) {
      this.#send({ event_type: 'set_property', property, value: String(value) });
    }

    async tune({ freqHz, mode }) {
      if (!Number.isFinite(freqHz) || freqHz <= 0 || !this.connected) return false;
      if (mode) this.setProperty('demodulator', mode);
      this.setProperty('device_center_frequency', Math.max(0, Math.round(freqHz)));
      await new Promise((resolve) => setTimeout(resolve, RETUNE_SETTLE_MS));
      this.setProperty('device_vfo_frequency', Math.round(freqHz));
      return true;
    }

    #handleMessage(raw) {
      let message;
      try {
        message = JSON.parse(raw);
      } catch {
        return;
      }
      if (message.event_type !== 'property_changed' && message.event_type !== 'get_property_response') return;
      if (message.device && message.device !== this.settings.device) return;
      this.properties[message.property] = message.value;
      this.onProperty(message.property, message.value);
    }

    #send(message) {
      if (!this.connected) return false;
      this.socket.send(JSON.stringify({ device: this.settings.device, ...message }));
      return true;
    }

    #closeSocket() {
      if (!this.socket) return;
      const socket = this.socket;
      this.socket = null;
      socket.discarded = true;
      try {
        socket.close();
      } catch {
        /* ignore */
      }
    }

    #scheduleReconnect() {
      if (this.stopped) return;
      clearTimeout(this.reconnectTimer);
      const delay = Math.min(RECONNECT_MIN_MS * Math.pow(1.5, this.attempt++), RECONNECT_MAX_MS);
      this.reconnectTimer = setTimeout(() => this.connect(), delay);
    }

    #setStatus(status) {
      if (this.status === status) return;
      this.status = status;
      this.onStatus(status);
    }
  }

  global.SdrConnectClient = SdrConnectClient;
})(window);
