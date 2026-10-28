// Reports the page sends about its view: a frame captured for the agent's
// visual check, and measured view bursts kept for an agent to read.

export function createViewReports(ctx){
  // The window's records and values this part uses; ctx.NAME marks a call into another part.
  const {viewPerformance}=ctx;
  // View reports from the page: a captured frame for the agent and measured view bursts.
  async function viewReportRoute(url,data,capturing,send){
    // A capture reply must not queue behind the operation awaiting this frame.
    if(capturing){ctx.viewerCapture.accept(data);send({ok:true});return true;}
    // Browser-measured view bursts, kept in memory for an agent to read.
    if(url.pathname==='/api/view-performance'){viewPerformance.push({receivedAt:new Date().toISOString(),...data});viewPerformance.splice(0,viewPerformance.length-20);send({ok:true});return true;}
    return false;
  }
  return {viewReportRoute};
}
