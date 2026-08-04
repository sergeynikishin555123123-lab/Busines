// core/queue.js
class RateLimiter {
  constructor(maxRequests, perMilliseconds) {
    this.maxRequests = maxRequests;
    this.perMilliseconds = perMilliseconds;
    this.tokens = maxRequests;
    this.lastRefill = Date.now();
    this.queue = [];
    this.processing = false;
  }

  async wait() {
    this.refillTokens();
    if (this.tokens > 0) {
      this.tokens--;
      return Promise.resolve();
    } else {
      return new Promise((resolve) => {
        this.queue.push(resolve);
        if (!this.processing) {
          this.processQueue();
        }
      });
    }
  }

  refillTokens() {
    const now = Date.now();
    const elapsed = now - this.lastRefill;
    const refillAmount = Math.floor(elapsed / this.perMilliseconds) * this.maxRequests;
    if (refillAmount > 0) {
      this.tokens = Math.min(this.maxRequests, this.tokens + refillAmount);
      this.lastRefill = now - (elapsed % this.perMilliseconds);
    }
  }

  processQueue() {
    if (this.queue.length === 0) {
      this.processing = false;
      return;
    }
    this.processing = true;
    this.refillTokens();
    while (this.queue.length > 0 && this.tokens > 0) {
      this.tokens--;
      const resolve = this.queue.shift();
      resolve();
    }
    if (this.queue.length > 0) {
      setTimeout(() => this.processQueue(), this.perMilliseconds);
    } else {
      this.processing = false;
    }
  }
}

module.exports = { RateLimiter };
