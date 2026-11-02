/** Erro esperado, causado pelo uso do programa (não é bug). */
export class TaskError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TaskError";
  }
}
