export const app = $state({
  project: null,
  view: 'watch',
  _tab: null,
  selectedRun: null,
  runFilter: { status: 'all', search: '' },
  highlightedRunIdx: -1,
  lastLearningsData: null,
  liveActive: false,
  screencast: false,
});

export const live = $state({
  runs: {},
  collapsed: new Set(),
  ssOpen: new Set(),
});

export const screencast = $state({
  frame: null,       // base64 JPEG data
  testName: null,    // which test the frame belongs to
  watching: null,    // which test the user selected to watch (null = auto)
});
