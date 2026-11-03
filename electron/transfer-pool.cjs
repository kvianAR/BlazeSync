class TransferPool {
  constructor(limit = 4) {
    this.limit = limit;
    this.running = 0;
    this.used = 0;
    this.keys = new Set();
    this.pending = [];
  }
  schedule(task, key = Symbol(), weight = 1) {
    return new Promise((resolve, reject) => {
      this.pending.push({ task, key, weight: Math.min(this.limit, weight), resolve, reject });
      this.drain();
    });
  }
  drain() {
    while (this.running < this.limit) {
      const index = this.pending.findIndex((job) => !this.keys.has(job.key) && this.used + job.weight <= this.limit);
      if (index < 0) return;
      const job = this.pending.splice(index, 1)[0];
      this.running++;
      this.used += job.weight;
      this.keys.add(job.key);
      Promise.resolve().then(job.task).then(job.resolve, job.reject).finally(() => {
        this.running--;
        this.used -= job.weight;
        this.keys.delete(job.key);
        this.drain();
      });
    }
  }
}
module.exports = { TransferPool };
