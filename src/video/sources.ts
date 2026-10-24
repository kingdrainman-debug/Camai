/**
 * Source frames, tagged by the film frame they are for.
 *
 * A film frame is exposed once and then held; the picture changes eighteen
 * times a second however often the display refreshes. So a source upload is
 * tagged with its film frame number and kept, and two are kept rather than
 * one because the mixed frames of a pulldown cadence show two film frames at
 * once. Both renderers use this, with a texture or a float buffer as the handle.
 */

export interface SourceSlot<H> {
  handle: H;
  tag: number;
  version: number;
  index: number;
}

export class SourceSlots<H> {
  readonly handles: H[];
  private tags: number[];
  private versions: number[];
  private used: number[];
  private counter = 0;
  private tick = 0;
  size = { width: 2, height: 2 };

  constructor(handles: H[]) {
    this.handles = handles;
    this.tags = handles.map(() => Number.NaN);
    this.versions = handles.map(() => 0);
    this.used = handles.map(() => 0);
  }

  /** Choose the slot a new upload for `tag` goes into. */
  claim(tag: number, width: number, height: number): SourceSlot<H> {
    let i = this.tags.indexOf(tag);
    if (i < 0) i = this.tags.findIndex((t) => Number.isNaN(t));
    if (i < 0) {
      // Evict the frame furthest from the new one. Not the least recently
      // used: a pulldown frame looks its first field's frame up last, which
      // would make the frame still needed by the next field look the oldest —
      // and evicting it showed the frame before it in its place.
      i = 0;
      for (let k = 1; k < this.tags.length; k++) {
        if (Math.abs(this.tags[k] - tag) > Math.abs(this.tags[i] - tag)) i = k;
      }
    }
    this.tags[i] = tag;
    this.versions[i] = ++this.counter;
    this.used[i] = ++this.tick;
    this.size = { width, height };
    return { handle: this.handles[i], tag, version: this.versions[i], index: i };
  }

  has(tag: number): boolean {
    return this.tags.includes(tag);
  }

  /** The slot holding `tag`, or the nearest earlier frame, or whatever there is. */
  lookup(tag: number): SourceSlot<H> {
    let i = this.tags.indexOf(tag);
    if (i < 0) {
      let best = -1;
      for (let k = 0; k < this.tags.length; k++) {
        const t = this.tags[k];
        if (Number.isNaN(t)) continue;
        if (t <= tag && (best < 0 || t > this.tags[best])) best = k;
      }
      if (best < 0) {
        for (let k = 0; k < this.tags.length; k++) if (best < 0 || this.used[k] > this.used[best]) best = k;
      }
      i = best;
    }
    this.used[i] = ++this.tick;
    return { handle: this.handles[i], tag: this.tags[i], version: this.versions[i], index: i };
  }

  clear(): void {
    this.tags = this.tags.map(() => Number.NaN);
  }
}

/**
 * Everything a rendered film frame depends on besides its number and its
 * source, as one string. A rendered film frame is reused across display
 * frames — three times a frame at 18 fps on a 60 Hz screen — until this
 * changes.
 */
export function settingsKey(settings: Record<string, unknown>, seed: number): string {
  return `${seed}|${JSON.stringify(settings)}`;
}

/**
 * Decide which of the two film-frame buffers each needed frame goes in,
 * re-using any that already hold it. `render(slot, i)` is called for the ones
 * that do not.
 */
export function placeFilmFrames(
  current: string[],
  wanted: string[],
  render: (slot: number, i: number) => void,
): number[] {
  const placed: number[] = [];
  for (let i = 0; i < wanted.length; i++) {
    let k = current.indexOf(wanted[i]);
    if (k < 0 || placed.includes(k)) {
      const later = wanted.slice(i + 1);
      k = [0, 1].find((j) => !placed.includes(j) && !later.includes(current[j])) ??
        [0, 1].find((j) => !placed.includes(j))!;
      render(k, i);
      current[k] = wanted[i];
    }
    placed.push(k);
  }
  return placed;
}
