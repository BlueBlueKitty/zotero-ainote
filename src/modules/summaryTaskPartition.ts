import { SummaryTask } from "./summaryTaskTypes";

export function isActiveTask(task: SummaryTask): boolean {
  return (
    task.status === "running" ||
    task.status === "pending" ||
    task.status === "failed" ||
    task.status === "cancelled"
  );
}

export function isHistoryTask(task: SummaryTask): boolean {
  return task.status === "completed";
}

function byCreatedAtAsc(a: SummaryTask, b: SummaryTask): number {
  if (a.createdAt !== b.createdAt) {
    return a.createdAt - b.createdAt;
  }
  return a.updatedAt - b.updatedAt;
}

function byUpdatedAtDesc(a: SummaryTask, b: SummaryTask): number {
  return (b.updatedAt || 0) - (a.updatedAt || 0);
}

function byFinishedAtDesc(a: SummaryTask, b: SummaryTask): number {
  return (b.finishedAt || b.updatedAt || 0) - (a.finishedAt || a.updatedAt || 0);
}

export function sortActiveTasks(tasks: SummaryTask[]): SummaryTask[] {
  const running = tasks
    .filter((task) => task.status === "running")
    .slice()
    .sort(byCreatedAtAsc);
  const pending = tasks
    .filter((task) => task.status === "pending")
    .slice()
    .sort(byCreatedAtAsc);
  const handled = tasks
    .filter((task) => task.status === "failed" || task.status === "cancelled")
    .slice()
    .sort(byUpdatedAtDesc);
  return [...running, ...pending, ...handled];
}

export function sortHistoryTasks(tasks: SummaryTask[]): SummaryTask[] {
  return tasks
    .filter((task) => task.status === "completed")
    .slice()
    .sort(byFinishedAtDesc);
}

