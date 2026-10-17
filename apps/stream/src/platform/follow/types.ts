export interface FollowPerson {
  id: number;
  visible_s: number;
  appearances: number;
  moved_m: number;
  follower: boolean;
  /** [x1, y1, x2, y2] in the frame we sent (FRAME_WIDTH px wide). */
  last_box: [number, number, number, number] | null;
  last_seen_s_ago: number | null;
  thumb?: string;
}

export interface FollowState {
  people: FollowPerson[];
  followers: number;
}

/** Everything the UI needs about the watch, published by useFollowerWatch and read by FollowerCard/Overlay. */
export interface FollowSnapshot {
  watching: boolean;
  /** Frames accepted by the service since the watch started. */
  frames: number;
  /** Null until the first frame round-trips; stays stale (not null) through transient errors. */
  state: FollowState | null;
  error: string | null;
  /** Natural size of the video the boxes refer to, for scaling last_box onto the player. */
  frameSize: { width: number; height: number } | null;
}
