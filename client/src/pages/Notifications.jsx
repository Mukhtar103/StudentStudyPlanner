import { useEffect,useRef,useState } from 'react';
import { Bell, BookOpen, Check, Clock3, Plus } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Alert,Button,Card,EmptyState,Input,LoadingState,PageHeader } from '../components/ui';
import { api } from '../services/api';
import { useSession } from '../services/session';
import { useDebouncedSearch } from '../services/useDebouncedSearch';
import { displayTime,useOverview } from './Calendar';

const changed=()=>window.dispatchEvent(new Event('notifications-changed'));
const sourceLink=item=>(item.sourceType==='task'?'/tasks/':'/study-plan/')+item.sourceId;
async function mutate(path,method,data={}) {
  const result=await api(path,{method,data});
  changed();
  return result;
}
export function NotificationBell() {
  const ref=useRef(null);
  const [count,setCount]=useState(0);
  const [open,setOpen]=useState(false);
  const [revision,setRevision]=useState(0);
  useEffect(()=>{
    const abort=new AbortController();
    const update=()=>api('/notifications/unread-count',{signal:abort.signal}).then(data=>setCount(data.count)).catch(()=>{});
    const refresh=()=>{void update();setRevision(n=>n+1);};
    void update();
    const timer=setInterval(()=>{if(!document.hidden) refresh();},20000);
    window.addEventListener('notifications-changed',refresh);
    return ()=>{abort.abort();clearInterval(timer);window.removeEventListener('notifications-changed',refresh);};
  },[]);
  useEffect(()=>{
    if(!open) return;
    const outside=event=>{if(!ref.current?.contains(event.target)) setOpen(false);};
    document.addEventListener('pointerdown',outside);
    return ()=>document.removeEventListener('pointerdown',outside);
  },[open]);
  return <div className="notification-bell" ref={ref} onKeyDown={event=>{
    if(event.key==='Escape') {setOpen(false);ref.current.querySelector('button').focus();}
  }}>
    <button type="button" className="icon-button" aria-label={'Notifications, '+count+' unread'} aria-expanded={open} aria-controls={open?'notification-popover':undefined}
      onClick={()=>setOpen(value=>!value)}><Bell size={19}/>{count>0&&<span className="notification-badge">{count>99?'99+':count}</span>}</button>
    {open&&<Recent revision={revision} close={()=>setOpen(false)}/>}
  </div>;
}
function Recent({revision,close}) {
  const {data,error}=useOverview('/notifications?limit=5',revision);
  const [markError,setMarkError]=useState('');
  return <Card className="notification-popover" >
    <div id="notification-popover"><h2>Recent notifications</h2>
      {error&&<Alert error>{error}</Alert>}
      {markError&&<Alert error>{markError}</Alert>}
      {!data&&!error&&<LoadingState label="Loading notifications"/>}
      {data?.items.length===0&&<p>No notifications yet.</p>}
      {data?.items.map(item=><div className="notification-recent" key={item.id}>
        <Link to={sourceLink(item)} onClick={()=>{close();if(!item.readAt) void mutate('/notifications/'+item.id+'/read','PATCH').catch(()=>{});}}>{item.title}</Link>
        {!item.readAt&&<button type="button" className="icon-button" aria-label={'Mark '+item.title+' as read'} onClick={()=>mutate('/notifications/'+item.id+'/read','PATCH').catch(error=>setMarkError(error.message))}><Check size={16}/></button>}
      </div>)}
      <Button to="/notifications" variant="secondary" onClick={close}>View all notifications</Button>
    </div>
  </Card>;
}
function ReminderDialog({editor,close,save,user}) {
  const ref=useRef(null);
  const [kind,setKind]=useState(editor.rule?.sessionId?'study':'task');
  const [appliedSearch,setAppliedSearch]=useState('');
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');
  const [source,setSource]=useState(String(editor.rule?.taskId??editor.rule?.sessionId??''));
  const [page,setPage]=useState(1);
  const [search,setSearch]=useDebouncedSearch(appliedSearch,value=>{setAppliedSearch(value);setPage(1);},kind==='task');
  const listing=useOverview(kind==='task'?'/tasks?limit=25&page='+page+(appliedSearch.trim()?'&search='+encodeURIComponent(appliedSearch.trim()):''):'/study-sessions?limit=25&page='+page,0);
  const prefs=useOverview('/preferences',0);
  const records=listing.data?.items??[];
  useEffect(()=>{ref.current.showModal();},[]);
  return <dialog className="academic-dialog" ref={ref} aria-labelledby="reminder-title" onCancel={event=>{event.preventDefault();if(!busy)close();}}>
    <h2 id="reminder-title">{editor.remove?'Delete reminder?':editor.rule?'Edit reminder':'New reminder'}</h2>
    <form aria-busy={busy} onSubmit={async event=>{
      event.preventDefault();
      if(busy)return;
      const data=new FormData(event.currentTarget);
      setBusy(true);setError('');
      try {
        await save(editor.remove?{}:{taskId:kind==='task'?Number(source):null,sessionId:kind==='study'?Number(source):null,
          channel:data.get('channel'),offsetMinutes:Number(data.get('offset')),enabled:data.has('enabled')});
        close();
      } catch(error){setError(error.message);}
      finally{setBusy(false);}
    }}>
      {editor.remove?<p>Delivery stops for this rule. Previously delivered notifications stay in your inbox.</p>:<>
        <p>Times use {user.timezone}. One study reminder applies to every occurrence in a series.</p>
        <div className="field"><label htmlFor="reminder-type">Source type</label><select id="reminder-type" value={kind} onChange={event=>{setKind(event.target.value);setSource('');setPage(1);}}>
          <option value="task">Task deadline</option><option value="study">Study session</option>
        </select></div>
        {kind==='task'&&<Input name="find-task" label="Find task" maxLength={150} value={search} onChange={event=>setSearch(event.target.value)}/>}
        <div className="field"><label htmlFor="reminder-source">Source record</label><select id="reminder-source" required value={source} onChange={event=>setSource(event.target.value)}>
          <option value="">Choose a record</option>
          {source&&!records.some(item=>String(item.id)===source)&&<option value={source}>Selected record #{source}</option>}
          {records.map(item=><option key={item.id} value={item.id}>{item.title}{item.startAt?' · '+displayTime(item.startAt,user,true):''}</option>)}
        </select></div>
        {listing.error&&<Alert error>{listing.error}</Alert>}
        {!listing.data&&!listing.error&&<LoadingState label="Loading records"/>}
        <div className="editor-actions">
          <Button variant="secondary" disabled={page<=1} onClick={()=>setPage(n=>n-1)}>Previous records</Button>
          <Button variant="secondary" disabled={!listing.data||page*25>=listing.data.total} onClick={()=>setPage(n=>n+1)}>Next records</Button>
        </div>
        <div className="task-field-grid">
          <Input key={prefs.data?.reminderMinutes??'initial'} name="offset" label="Minutes before" type="number" min={0} max={10080} required defaultValue={editor.rule?.offsetMinutes??prefs.data?.reminderMinutes??30}/>
          <div className="field"><label htmlFor="reminder-channel">Delivery channel</label><select name="channel" id="reminder-channel" defaultValue={editor.rule?.channel??'in_app'}><option value="in_app">In-app</option><option value="email">Email</option></select></div>
        </div>
        <div className="check-list"><label><input name="enabled" type="checkbox" defaultChecked={editor.rule?Boolean(editor.rule.enabled):true}/> Enabled</label></div>
      </>}
      {error&&<Alert error>{error}</Alert>}
      <div className="editor-actions"><Button variant="secondary" disabled={busy} onClick={close}>Cancel</Button><Button type="submit" disabled={busy}>{editor.remove?'Delete reminder':'Save reminder'}</Button></div>
    </form>
  </dialog>;
}
export default function Notifications() {
  const {user}=useSession();
  const [tab,setTab]=useState('all');
  const [page,setPage]=useState(1);
  const [revision,refresh]=useState(0);
  const [editor,setEditor]=useState(null);
  const [remove,setRemove]=useState(null);
  const [error,setError]=useState('');
  const [notice,setNotice]=useState('');
  const [busy,setBusy]=useState(false);
  const limit=10;
  const rules=tab==='rules';
  const data=useOverview((rules?'/reminders':'/notifications')+'?limit='+limit+'&page='+page+(tab==='unread'?'&read=unread':''),revision);
  const count=useOverview('/notifications/unread-count',revision);
  const confirmation=useRef(null);
  useEffect(()=>{if(remove)confirmation.current.showModal();},[remove]);
  useEffect(()=>{
    const update=()=>refresh(n=>n+1);
    window.addEventListener('notifications-changed',update);
    const timer=setInterval(()=>{if(!document.hidden) update();},20000);
    return ()=>{clearInterval(timer);window.removeEventListener('notifications-changed',update);};
  },[]);
  async function update(path,method,payload,message) {
    setError('');setNotice('');setBusy(true);
    try {await mutate(path,method,payload);setNotice(message);}
    catch(error){setError(error.message);}
    finally{setBusy(false);}
  }
  return <>
    <PageHeader title="Notifications" description={(count.data?.count??0)+' unread · Manage reminders for deadlines and study sessions.'}>
      <Button onClick={()=>setEditor({})}><Plus size={17}/> New reminder</Button>
    </PageHeader>
    <div className="notification-toolbar editor-actions">
      {[[ 'all','All' ],[ 'unread','Unread' ],[ 'rules','Reminder rules' ]].map(([key,label])=><Button key={key} variant={tab===key?'primary':'secondary'} aria-pressed={tab===key}
        onClick={()=>{setTab(key);setPage(1);setError('');setNotice('');}}>{label}</Button>)}
      {!rules&&<Button variant="secondary" disabled={busy||!count.data?.count} onClick={()=>update('/notifications/read-all','PATCH',{},'All notifications marked read.')}>Mark all as read</Button>}
      <Button variant="secondary" to="/settings">Preferences</Button>
    </div>
    {notice&&<div className="dashboard-notice"><Alert>{notice}</Alert></div>}
    {(error||data.error)&&<Card><Alert error>{error||data.error}</Alert><Button className="retry-session" onClick={()=>{setError('');refresh(n=>n+1);}}>Retry</Button></Card>}
    {!data.data&&!data.error&&<Card><LoadingState label="Loading notifications"/></Card>}
    {data.data?.items.length===0&&<EmptyState icon={Bell} title={rules?'No reminder rules':tab==='unread'?'You’re all caught up':'No notifications yet'}
      description={rules?'Add a reminder for an upcoming deadline or study session.':'Delivered in-app reminders appear here.'}/>}
    {data.data?.items.length>0&&<Card className="notification-list">
      {data.data.items.map(item=>{
        const type=rules?(item.taskId?'task':'study'):item.sourceType;
        const Icon=type==='task'?BookOpen:Clock3;
        return <article className="notification-row" key={item.id}>
          <span className={'tile '+(type==='task'?'amber':'violet')}><Icon size={18}/></span>
          <div>{rules?<><Link className="task-title" to={sourceLink({sourceType:type,sourceId:item.taskId??item.sessionId})}>{item.title??(type==='task'?'Task deadline':'Study session')}</Link>
            <small>{item.offsetMinutes} min before · {item.channel==='email'?'Email':'In-app'} · {item.enabled?'Enabled':'Disabled'}</small></>:
            <><Link className="task-title" to={sourceLink(item)} onClick={()=>{if(!item.readAt)void mutate('/notifications/'+item.id+'/read','PATCH').catch(()=>{});}}>{item.title}</Link>
              <small>{item.message} · {displayTime(item.deliveredAt??item.scheduledAt,user,true)} · {item.readAt?'Read':'Unread'}</small></>}</div>
          <div className="editor-actions">
            {rules?<Button variant="secondary" onClick={()=>setEditor({rule:item})}>Edit</Button>:!item.readAt&&<Button variant="secondary" disabled={busy}
              onClick={()=>update('/notifications/'+item.id+'/read','PATCH',{},'Marked as read.')}>Mark as read</Button>}
            <Button variant="secondary" disabled={busy} onClick={()=>rules?setEditor({rule:item,remove:true}):setRemove(item)}>Delete</Button>
          </div>
        </article>;
      })}
    </Card>}
    {data.data&&(data.data.total>limit||page>1)&&<div className="academic-pagination">
      <Button variant="secondary" disabled={page===1} onClick={()=>setPage(n=>n-1)}>Previous</Button><span>Page {page}</span>
      <Button variant="secondary" disabled={page*limit>=data.data.total} onClick={()=>setPage(n=>n+1)}>Next</Button>
    </div>}
    {editor&&<ReminderDialog editor={editor} user={user} close={()=>setEditor(null)} save={async payload=>{
      await mutate('/reminders'+(editor.rule?'/'+editor.rule.id:''),editor.remove?'DELETE':editor.rule?'PATCH':'POST',payload);
      setTab('rules');setPage(1);setNotice(editor.remove?'Reminder deleted.':'Reminder saved.');
    }}/>}
    {remove&&<dialog className="academic-dialog" ref={confirmation} aria-labelledby="delete-notification" onCancel={event=>{event.preventDefault();setRemove(null);}}>
      <h2 id="delete-notification">Delete notification?</h2><p>{remove.title} will be removed from your inbox.</p>
      <div className="editor-actions calendar-dialog-actions"><Button variant="secondary" onClick={()=>setRemove(null)}>Cancel</Button>
        <Button onClick={()=>{void update('/notifications/'+remove.id,'DELETE',{},'Notification deleted.');setRemove(null);}}>Delete notification</Button></div>
    </dialog>}
  </>;
}
