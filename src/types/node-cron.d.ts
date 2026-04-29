declare module "node-cron" {
  export interface ScheduledTask {
    start(): void;
    stop(): void;
    destroy?(): void;
  }

  export interface ScheduleOptions {
    timezone?: string;
  }

  export function schedule(
    expression: string,
    func: () => void | Promise<void>,
    options?: ScheduleOptions,
  ): ScheduledTask;

  const cron: {
    schedule: typeof schedule;
  };

  export default cron;
}
