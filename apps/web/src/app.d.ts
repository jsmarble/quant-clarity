import type { PublicationState } from "./lib/dataset-metadata.js";

declare global {
  namespace App {
    interface Locals {
      publicationState: PublicationState;
    }
  }
}

export {};
