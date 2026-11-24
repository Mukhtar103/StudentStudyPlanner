import { t, useLanguage } from '../services/language';
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
  useLanguage();
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
    <button type="button" className="icon-button" aria-label={t('Notifications, ')+t(count)+t(' unread')} aria-expanded={open} aria-controls={open?'notification-popover':undefined}
      onClick={()=>setOpen(value=>!value)}><Bell size={19}/>{count>0&&<span className="notification-badge">{count>99?t('99+'):t(count)}</span>}</button>
    {open&&<Recent revision={revision} close={()=>setOpen(false)}/>}
  </div>;
}
function Recent({revision,close}) {
  useLanguage();
  const {data,error}=useOverview('/notifications?limit=5',revision);
  const [markError,setMarkError]=useState('');
  return <Card className="notification-popover" >
    <div id="notification-popover"><h2>{t("Recent notifications")}</h2>
      {error&&<Alert error>{t(error)}</Alert>}
      {markError&&<Alert error>{t(markError)}</Alert>}
      {!data&&!error&&<LoadingState label={t("Loading notifications")}/>}
      {data?.items.length===0&&<p>{t("No notifications yet.")}</p>}
      {t(data?.items.map(item=><div className="notification-recent" key={item.id}>
        <Link to={sourceLink(item)} onClick={()=>{close();if(!item.readAt) void mutate('/notifications/'+item.id+'/read','PATCH').catch(()=>{});}}>{item.title}</Link>
        {!item.readAt&&<button type="button" className="icon-button" aria-label={t('Mark ')+item.title+t(' as read')} onClick={()=>mutate('/notifications/'+item.id+'/read','PATCH').catch(error=>setMarkError(error.message))}><Check size={16}/></button>}
      </div>))}
      <Button to="/notifications" variant="secondary" onClick={close}>{t("View all notifications")}</Button>
    </div>
  </Card>;
}
function ReminderDialog({editor,close,save,user}) {
  useLanguage();
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
    <h2 id="reminder-title">{editor.remove?t('Delete reminder?'):editor.rule?t('Edit reminder'):t('New reminder')}</h2>
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
      {editor.remove?<p>{t("Delivery stops for this rule. Previously delivered notifications stay in your inbox.")}</p>:<>
        <p>{t("Times use ")}{t(user.timezone)}{t(". One study reminder applies to every occurrence in a series.")}</p>
        <div className="field"><label htmlFor="reminder-type">{t("Source type")}</label><select id="reminder-type" value={kind} onChange={event=>{setKind(event.target.value);setSource('');setPage(1);}}>
          <option value="task">{t("Task deadline")}</option><option value="study">{t("Study session")}</option>
        </select></div>
        {kind==='task'&&<Input name="find-task" label={t("Find task")} maxLength={150} value={search} onChange={event=>setSearch(event.target.value)}/>}
        <div className="field"><label htmlFor="reminder-source">{t("Source record")}</label><select id="reminder-source" required value={source} onChange={event=>setSource(event.target.value)}>
          <option value="">{t("Choose a record")}</option>
          {source&&!records.some(item=>String(item.id)===source)&&<option value={source}>{t("Selected record #")}{t(source)}</option>}
          {t(records.map(item=><option key={item.id} value={item.id}>{item.title}{item.startAt?t(' · ')+t(displayTime(item.startAt,user,true)):t('')}</option>))}
        </select></div>
        {listing.error&&<Alert error>{t(listing.error)}</Alert>}
        {!listing.data&&!listing.error&&<LoadingState label={t("Loading records")}/>}
        <div className="editor-actions">
          <Button variant="secondary" disabled={page<=1} onClick={()=>setPage(n=>n-1)}>{t("Previous records")}</Button>
          <Button variant="secondary" disabled={!listing.data||page*25>=listing.data.total} onClick={()=>setPage(n=>n+1)}>{t("Next records")}</Button>
        </div>
        <div className="task-field-grid">
          <Input key={prefs.data?.reminderMinutes??'initial'} name="offset" label={t("Minutes before")} type="number" min={0} max={10080} required defaultValue={editor.rule?.offsetMinutes??prefs.data?.reminderMinutes??30}/>
          <div className="field"><label htmlFor="reminder-channel">{t("Delivery channel")}</label><select name="channel" id="reminder-channel" defaultValue={editor.rule?.channel??'in_app'}><option value="in_app">{t("In-app")}</option><option value="email">{t("Email")}</option></select></div>
        </div>
        <div className="check-list"><label><input name="enabled" type="checkbox" defaultChecked={editor.rule?Boolean(editor.rule.enabled):true}/>{t(" Enabled")}</label></div>
      </>}
      {error&&<Alert error>{t(error)}</Alert>}
      <div className="editor-actions"><Button variant="secondary" disabled={busy} onClick={close}>{t("Cancel")}</Button><Button type="submit" disabled={busy}>{editor.remove?t('Delete reminder'):t('Save reminder')}</Button></div>
    </form>
  </dialog>;
}
export default function Notifications() {
  useLanguage();
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
    <PageHeader title={t("Notifications")} description={(count.data?.count??t(0))+t(' unread · Manage reminders for deadlines and study sessions.')}>
      <Button onClick={()=>setEditor({})}><Plus size={17}/>{t(" New reminder")}</Button>
    </PageHeader>
    <div className="notification-toolbar editor-actions">
      {t([[ 'all','All' ],[ 'unread','Unread' ],[ 'rules','Reminder rules' ]].map(([key,label])=><Button key={key} variant={tab===key?'primary':'secondary'} aria-pressed={tab===key}
        onClick={()=>{setTab(key);setPage(1);setError('');setNotice('');}}>{t(label)}</Button>))}
      {!rules&&<Button variant="secondary" disabled={busy||!count.data?.count} onClick={()=>update('/notifications/read-all','PATCH',{},'All notifications marked read.')}>{t("Mark all as read")}</Button>}
      <Button variant="secondary" to="/settings">{t("Preferences")}</Button>
    </div>
    {notice&&<div className="dashboard-notice"><Alert>{t(notice)}</Alert></div>}
    {(error||data.error)&&<Card><Alert error>{error||t(data.error)}</Alert><Button className="retry-session" onClick={()=>{setError('');refresh(n=>n+1);}}>{t("Retry")}</Button></Card>}
    {!data.data&&!data.error&&<Card><LoadingState label={t("Loading notifications")}/></Card>}
    {data.data?.items.length===0&&<EmptyState icon={Bell} title={rules?t('No reminder rules'):tab==='unread'?t('You’re all caught up'):t('No notifications yet')}
      description={rules?t('Add a reminder for an upcoming deadline or study session.'):t('Delivered in-app reminders appear here.')}/>}
    {data.data?.items.length>0&&<Card className="notification-list">
      {t(data.data.items.map(item=>{
        const type=rules?(item.taskId?'task':'study'):item.sourceType;
        const Icon=type==='task'?BookOpen:Clock3;
        return <article className="notification-row" key={item.id}>
          <span className={'tile '+(type==='task'?'amber':'violet')}><Icon size={18}/></span>
          <div>{rules?<><Link className="task-title" to={sourceLink({sourceType:type,sourceId:item.taskId??item.sessionId})}>{item.title??(type==='task'?t('Task deadline'):t('Study session'))}</Link>
            <small>{t(item.offsetMinutes)}{t(" min before · ")}{item.channel==='email'?t('Email'):t('In-app')} · {item.enabled?t('Enabled'):t('Disabled')}</small></>:
            <><Link className="task-title" to={sourceLink(item)} onClick={()=>{if(!item.readAt)void mutate('/notifications/'+item.id+'/read','PATCH').catch(()=>{});}}>{item.title}</Link>
              <small>{t(item.message)} · {t(displayTime(item.deliveredAt??item.scheduledAt,user,true))} · {item.readAt?t('Read'):t('Unread')}</small></>}</div>
          <div className="editor-actions">
            {rules?<Button variant="secondary" onClick={()=>setEditor({rule:item})}>{t("Edit")}</Button>:!item.readAt&&<Button variant="secondary" disabled={busy}
              onClick={()=>update('/notifications/'+item.id+'/read','PATCH',{},'Marked as read.')}>{t("Mark as read")}</Button>}
            <Button variant="secondary" disabled={busy} onClick={()=>rules?setEditor({rule:item,remove:true}):setRemove(item)}>{t("Delete")}</Button>
          </div>
        </article>;
      }))}
    </Card>}
    {data.data&&(data.data.total>limit||page>1)&&<div className="academic-pagination">
      <Button variant="secondary" disabled={page===1} onClick={()=>setPage(n=>n-1)}>{t("Previous")}</Button><span>{t("Page ")}{t(page)}</span>
      <Button variant="secondary" disabled={page*limit>=data.data.total} onClick={()=>setPage(n=>n+1)}>{t("Next")}</Button>
    </div>}
    {editor&&<ReminderDialog editor={editor} user={user} close={()=>setEditor(null)} save={async payload=>{
      await mutate('/reminders'+(editor.rule?'/'+editor.rule.id:''),editor.remove?'DELETE':editor.rule?'PATCH':'POST',payload);
      setTab('rules');setPage(1);setNotice(editor.remove?'Reminder deleted.':'Reminder saved.');
    }}/>}
    {remove&&<dialog className="academic-dialog" ref={confirmation} aria-labelledby="delete-notification" onCancel={event=>{event.preventDefault();setRemove(null);}}>
      <h2 id="delete-notification">{t("Delete notification?")}</h2><p>{remove.title}{t(" will be removed from your inbox.")}</p>
      <div className="editor-actions calendar-dialog-actions"><Button variant="secondary" onClick={()=>setRemove(null)}>{t("Cancel")}</Button>
        <Button onClick={()=>{void update('/notifications/'+remove.id,'DELETE',{},'Notification deleted.');setRemove(null);}}>{t("Delete notification")}</Button></div>
    </dialog>}
  </>;
}
