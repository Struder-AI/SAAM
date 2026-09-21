// Source replay does not consume printable geometry. Keep the worker message
// bounded even when Studio's plan contains a large imported or voxelized mesh.
// Tool declarations remain because H2D source validation uses them to replay
// multi-nozzle changes and colors.
export function playbackPlan(plan) {
  const lineNetwork=plan.skills?.['line-network'];
  return {
    output:plan.output,
    setup:plan.setup,
    process:plan.process,
    skills:{'line-network':{
      enabled:lineNetwork?.enabled===true,
      networks:(lineNetwork?.networks??[]).map(network=>network.tool?{tool:network.tool}:{})
    }}
  };
}
