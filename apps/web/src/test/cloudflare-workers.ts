/** Stand-in for the Workers runtime module. */
export class WorkerEntrypoint {
  constructor(public ctx: unknown, public env: unknown) {}
}
