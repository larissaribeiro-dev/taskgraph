export type Priority = 1 | 2 | 3;

export const PRIORITY_LABEL: Record<Priority, string> = {
  1: "baixa",
  2: "média",
  3: "alta",
};

export interface Task {
  id: number;
  title: string;
  done: boolean;
  priority: Priority;
  /** Data limite no formato AAAA-MM-DD, ou null. */
  due: string | null;
  tags: string[];
  /** Ids das tarefas que precisam estar concluídas antes desta. */
  deps: number[];
  createdAt: string;
  doneAt: string | null;
}

export interface Db {
  version: 1;
  nextId: number;
  tasks: Task[];
}

export function emptyDb(): Db {
  return { version: 1, nextId: 1, tasks: [] };
}
