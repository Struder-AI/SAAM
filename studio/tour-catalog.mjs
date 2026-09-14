export const TOUR_VERSION=1;
export const TOUR_DEMOS=[
  {id:'surface-drape',title:'Rolling hills',subtitle:'Let layers follow the shape'},
  {id:'wavy-denso',title:'Wavy DENSO',subtitle:'Print in more than one direction'},
  {id:'nudge-cup',title:'Nudge Cup',subtitle:'Combine patterns in one useful part'}
];
export const TOUR_STEPS=[
  {demo:'surface-drape',tab:'geometry',title:'Start with an idea',body:'Tell your agent what you want to make. It handles the tools, geometry, and printing settings, then brings the results here for you to review. You guide the design through conversation. No CAD, slicing, or programming experience is needed.',try:'For this curved part, you could ask: “Make the roof more wavy and show me the new shape.” Drag to look around before deciding.'},
  {demo:'surface-drape',tab:'plan',title:'Compose a printing recipe',body:'Walls, sparse infill, solid surfaces and a draped skin are separate skills working on the same part. Settings describe how each contributes material.',try:'Look at the body fill and the three draped skin layers.'},
  {demo:'surface-drape',tab:'toolpath',title:'See what the machine will do',body:'Flat layers build the body; the final skin follows the roof. Layer controls and playback let you inspect the proposed motion before making anything.',try:'Step back through the skin layers, then press Play.'},
  {demo:'wavy-denso',tab:'geometry',title:'Use the same workflow on another machine',body:'This spline tube has a circular bore and a wavy exterior. SAAM uses shared geometry and motion interfaces across printers and robot systems.',try:'Use Top view to find the bore.'},
  {demo:'wavy-denso',tab:'toolpath',title:'Change the direction of deposition',body:'Six exterior shells alternate axial and circumferential cladding. Different patterns can build on the same underlying surface.',try:'Select Axial or Circumferential below the timeline to inspect each pattern.'},
  {demo:'wavy-denso',tab:'toolpath',machine:true,title:'Connect the path to the machine',body:'Machine view relates the tool and rotary to the same recorded motion. This example uses a nominal setup; a complete arm overlay requires an aligned installation.',try:'Compare Machine view with the part view. No hardware is connected.'},
  {demo:'nudge-cup',tab:'geometry',title:'Give each region a purpose',body:'Nudge Cup is printed mouth-down, then turned over. A light cup and a heavier rounded foot form one object. Self-righting is a design intent to test, not a measured result.',try:'Inspect the rounded foot. The shape is a solid guide; the toolpath reveals the hollow cup that the recipe makes.'},
  {demo:'nudge-cup',tab:'plan',title:'Put material where it helps',body:'The reinforced lip, spiral wall and solid foot use different printing skills. Their order and contact surfaces matter as much as the outside shape.',try:'Compare the open-lip, light-cup and weighted-foot regions.'},
  {demo:'nudge-cup',tab:'toolpath',title:'Make it yours',body:'Your copy is already saved in local Prints. Ask your agent to change it, then review the new geometry, settings and toolpath. You can return to these examples any time.',try:'Copy the suggested request below, or choose Use this example to begin the normal review workflow.'}
];
