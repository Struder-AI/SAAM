// Trusted native hooks deliver the same durable inbox as SAAM command results.
// They report no lifecycle events: the passive app-server observer owns those.
import {control} from './transport.mjs';

export async function deliverCodexContext(config,{input=process.stdin,output=process.stdout}={}){
  const chunks=[];
  for await(const chunk of input)chunks.push(Buffer.from(chunk));
  const event=JSON.parse(Buffer.concat(chunks).toString('utf8'));
  if(!event.session_id||event.agent_id||event.agentId||!['UserPromptSubmit','PostToolUse'].includes(event.hook_event_name))return;
  const {message}=await control(config,{command:'client-inbox',client:'codex',sessionId:event.session_id,includeHeld:true});
  if(!message)return;
  const result={hookSpecificOutput:{hookEventName:event.hook_event_name,additionalContext:message.text}};
  await new Promise((done,fail)=>output.write(JSON.stringify(result)+'\n',error=>error?fail(error):done()));
  await control(config,{command:'client-ack',client:'codex',sessionId:event.session_id,eventIds:message.ids});
}
