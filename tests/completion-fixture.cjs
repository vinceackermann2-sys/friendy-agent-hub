// Mechanics tests use scripted model replies. Supply the new completion envelope
// for those replies; semantic coverage is exercised separately in devday-improvements.
module.exports=function completed(answer){
  if(!answer?.text || answer.functionCalls?.length)return answer;
  return {...answer,text:answer.text+'\n<task_coverage>'+JSON.stringify({requirements:[{id:'fixture',text:'Return the scripted test deliverable',status:'done',deliverable:answer.text.slice(0,300)}]})+'</task_coverage>'};
};
