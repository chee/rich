import * as A from "@automerge/automerge"

/// The subset of the `automerge-repo` `DocHandle` interface that this
/// library needs. Any object implementing this shape (including a real
/// `automerge-repo` `DocHandle`) can be passed to {@link init} and
/// {@link automergeSyncPlugin}.
export interface DocHandle<T> {
  /// The current document.
  doc(): A.Doc<T>
  /// Apply a change to the document.
  change(callback: (doc: A.Doc<T>) => void): void
  /// Subscribe to change notifications.
  on(event: "change", callback: (payload: DocHandleChangePayload<T>) => void): void
  /// Unsubscribe from change notifications.
  off(event: "change", callback: (payload: DocHandleChangePayload<T>) => void): void
}

/// The payload passed to `"change"` listeners. Matches the payload
/// emitted by `automerge-repo`. We only rely on the fields listed
/// here.
export interface DocHandleChangePayload<T> {
  /// The document after the change.
  doc: A.Doc<T>
  /// The patches describing the change.
  patches: A.Patch[]
}
