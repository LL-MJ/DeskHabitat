export interface FixedStepClockOptions {
  stepMilliseconds?: number;
  maxStepsPerFrame?: number;
}

export class FixedStepClock {
  readonly stepMilliseconds: number;
  readonly maxStepsPerFrame: number;
  private accumulatorMilliseconds = 0;

  constructor(options: FixedStepClockOptions = {}) {
    this.stepMilliseconds = options.stepMilliseconds ?? 100;
    this.maxStepsPerFrame = options.maxStepsPerFrame ?? 5;

    if (!Number.isFinite(this.stepMilliseconds) || this.stepMilliseconds <= 0) {
      throw new RangeError('Simulation step must be a positive number.');
    }
    if (!Number.isInteger(this.maxStepsPerFrame) || this.maxStepsPerFrame < 1) {
      throw new RangeError('Maximum steps per frame must be a positive integer.');
    }
  }

  advance(
    elapsedMilliseconds: number,
    update: (stepSeconds: number) => void,
  ): number {
    if (!Number.isFinite(elapsedMilliseconds) || elapsedMilliseconds <= 0) {
      return 0;
    }

    const maximumElapsed = this.stepMilliseconds * this.maxStepsPerFrame;
    this.accumulatorMilliseconds += Math.min(elapsedMilliseconds, maximumElapsed);

    let steps = 0;
    while (
      this.accumulatorMilliseconds >= this.stepMilliseconds &&
      steps < this.maxStepsPerFrame
    ) {
      update(this.stepMilliseconds / 1000);
      this.accumulatorMilliseconds -= this.stepMilliseconds;
      steps += 1;
    }

    return steps;
  }

  reset(): void {
    this.accumulatorMilliseconds = 0;
  }
}
