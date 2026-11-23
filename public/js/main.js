/* Bounty Hunter — ЛР №5. Усі змінні дані надходять із REST API (SQLite), а не з констант JS. */
(() => {
  'use strict';
  const $ = (selector, root=document) => root.querySelector(selector);
  const $$ = (selector, root=document) => Array.from(root.querySelectorAll(selector));
  const params = new URLSearchParams(location.search);
  const value = (id) => document.getElementById(id)?.value.trim() || '';
  const setText = (id, text) => { const element = document.getElementById(id); if(element) element.textContent=String(text ?? ''); };
  const labelCategory = (category) => ({frontend:'Frontend',backend:'Backend',fullstack:'Fullstack'}[category] || category);
  let me=null;

  function dom(tag, cls='', content) {
    const element=document.createElement(tag);
    if(cls) element.className=cls;
    if(content!==undefined) element.textContent=String(content ?? '');
    return element;
  }
  function link(text,href,cls='btn') {
    const element=dom('a',cls,text); element.href=href; return element;
  }
  function notice(text) {
    const node=dom('p','form-error',text); node.setAttribute('role','alert');
    ($('main') || document.body).append(node);
  }
  async function api(url, options={}) {
    const headers={'X-Requested-With':'XMLHttpRequest',...options.headers};
    if (Object.hasOwn(options,'body') && typeof options.body !== 'string') {
      headers['Content-Type']='application/json';
      options.body=JSON.stringify(options.body);
    }
    let response;
    try { response=await fetch(url,{...options,headers,credentials:'same-origin'}); }
    catch { throw new Error('Немає зв’язку з сервером. Перевірте підключення.'); }
    const result=await response.json().catch(()=>({}));
    if(!response.ok) throw new Error(result.error || `Помилка HTTP ${response.status}`);
    return result;
  }
  function initials(name) {
    const pieces=String(name).trim().split(/\s+/);
    return (pieces.length>1?pieces.slice(0,2).map(s=>s[0]).join(''):pieces[0]?.slice(0,2)||'BH').toUpperCase();
  }
  function formatStatus(status) { return ({pending:'Очікує',accepted:'Прийнято',rejected:'Відхилено'})[status] || status; }
  function debounce(fn,delay=180) {
    let timer;
    return (...args)=>{ clearTimeout(timer); timer=setTimeout(()=>fn(...args),delay); };
  }
  function safeNext() {
    const next=params.get('next') || 'home.html';
    return /^(home|jobs|job|freelancers|freelancer|chat|profile|applications)\.html(?:\?[-\w=&%]+)?$/.test(next) ? next : 'home.html';
  }
  function loginUrl(next=location.pathname.split('/').pop()+location.search) {
    return `index.html?next=${encodeURIComponent(next)}`;
  }
  async function initNav() {
    try { me=(await api('/api/auth/me')).user; } catch { me=null; }
    $$('[data-logout]').forEach(a=>{
      if(!me) { a.textContent='Увійти';a.href=loginUrl();return; }
      a.addEventListener('click',async event=>{
        event.preventDefault();
        try { await api('/api/auth/logout',{method:'POST',body:{}}); location.href='index.html'; }
        catch(error) { notice(error.message); }
      });
    });
    if(me && me.role==='freelancer') {
      const nav=$('.site-nav');
      if(nav && !nav.querySelector('[data-my-profile]')) {
        const a=link('Мій профіль','profile.html','');a.setAttribute('data-my-profile','');
        const logout=nav.querySelector('[data-logout]');nav.insertBefore(a,logout);
      }
    }
  }

  function initAuth() {
    const login=$('#login-form');
    if(login) login.addEventListener('submit',async event=>{
      event.preventDefault();setText('login-error','');
      const username=value('login'),password=$('#password').value;
      if(!username || !password) {setText('login-error','Введіть логін і пароль.');return;}
      const button=login.querySelector('[type=submit]');button.disabled=true;
      try { await api('/api/auth/login',{method:'POST',body:{username,password}});location.href=safeNext(); }
      catch(error) {setText('login-error',error.message);}finally{button.disabled=false;}
    });
    const register=$('#register-form');
    if(register) register.addEventListener('submit',async event=>{
      event.preventDefault();setText('register-error','');
      const username=value('r-login'),email=value('r-email'),password=$('#r-pass').value,role=$('#r-role').value;
      if(!/^[A-Za-z0-9_-]{3,32}$/.test(username)) {setText('register-error','Логін: 3–32 символи, латиниця, цифри, _ або -.');return;}
      if(!/^\S+@\S+\.\S+$/.test(email)) {setText('register-error','Укажіть коректний email.');return;}
      if(password.length<8) {setText('register-error','Пароль має містити щонайменше 8 символів.');return;}
      const button=register.querySelector('[type=submit]');button.disabled=true;
      try { await api('/api/auth/register',{method:'POST',body:{username,email,password,role}});location.href='home.html'; }
      catch(error){setText('register-error',error.message);}finally{button.disabled=false;}
    });
  }

  function createFreelancerCard(f) {
    const li=dom('li');
    const article=dom('article','card result');
    article.dataset.category=f.category;article.dataset.level=f.level;
    article.dataset.rating=String(f.rating);article.dataset.status=f.availability;
    const avatar=dom('div','photo',initials(f.name));avatar.setAttribute('aria-hidden','true');
    const body=dom('div','result__body'),meta=dom('div','result__meta');
    meta.append(dom('h2','',f.name),dom('span','tag',labelCategory(f.category)),dom('span','tag tag--muted',f.level),dom('span','status status--'+f.availability,f.availability==='free'?'Free':'Busy'));
    const rating=dom('span','rating',`★ ${f.rating}`);rating.setAttribute('aria-label',`Рейтинг ${f.rating}`);
    meta.append(rating);body.append(meta,dom('p','',f.bio));
    article.append(avatar,body,link('докладніше',`freelancer.html?id=${f.id}`));li.append(article);
    return li;
  }
  function createJobCard(j, onEdit, onDelete) {
    const li=dom('li'),article=dom('article','card result');
    const avatar=dom('div','photo',initials(j.company));avatar.setAttribute('aria-hidden','true');
    const body=dom('div','result__body'),meta=dom('div','result__meta');
    meta.append(dom('h2','',j.title),dom('span','tag',labelCategory(j.category)),dom('span','tag tag--muted',j.level));
    body.append(meta,dom('p','',j.description.length>200?j.description.slice(0,200)+'…':j.description));
    const controls=dom('div','result__manage');controls.append(link('докладніше',`job.html?id=${j.id}`));
    if(me?.role==='client'&&me.id===j.owner_id) {
      const edit=dom('button','btn btn--outline','Редагувати');edit.type='button';edit.addEventListener('click',()=>onEdit(j));
      const remove=dom('button','btn btn--outline','Видалити');remove.type='button';remove.addEventListener('click',()=>onDelete(j));
      controls.append(edit,remove);
    }
    article.append(avatar,body,controls);li.append(article);return li;
  }
  function listFilters() {
    const query=new URLSearchParams();
    $$('[data-filter]').forEach(input=>{
      if(input.value) query.set(input.dataset.filter==='status'?'availability':input.dataset.filter,input.value);
    });
    const search=$('[data-search]')?.value.trim();if(search) query.set('search',search);
    return query;
  }
  function initLists() {
    const results=$('#results');if(!results)return;
    const jobs=location.pathname.endsWith('/jobs.html');
    let latest=0;
    const render=async()=>{
      const sequence=++latest;
      try {
        const data=await api(`/api/${jobs?'jobs':'freelancers'}?${listFilters().toString()}`);
        if(sequence!==latest)return;
        results.replaceChildren(...data.items.map(item=>jobs?createJobCard(item,editJob,deleteJob):createFreelancerCard(item)));
        const empty=$('#empty');if(empty){empty.hidden=data.items.length>0;empty.textContent=jobs?'Вакансій не знайдено. Змініть фільтри.':'Нікого не знайдено. Змініть фільтри.';}
      } catch(error) {
        if(sequence!==latest)return;
        results.replaceChildren();const empty=$('#empty');if(empty){empty.hidden=false;empty.textContent=error.message;}
      }
    };
    $$('[data-filter]').forEach(input=>input.addEventListener('change',render));
    $('[data-search]')?.addEventListener('input',debounce(render));
    $('#filters')?.addEventListener('submit',event=>event.preventDefault());
    if(jobs) initJobEditor(render);
    render();
  }
  let editJob=()=>{},deleteJob=()=>{};
  function initJobEditor(refresh) {
    const modal=$('#job-modal'),form=$('#job-editor'),add=$('#new-job');
    if(!modal || !form)return;
    let editingId=null;
    const fields={title:'e-title',company:'e-company',category:'e-category',level:'e-level',budget:'e-budget',deadline:'e-deadline',work_format:'e-format',description:'e-description'};
    const open=(job)=>{
      editingId=job?.id||null;
      form.reset();setText('job-form-error','');setText('job-modal-title',editingId?'Редагувати вакансію':'Нова вакансія');
      if(job)for(const [key,id] of Object.entries(fields)) $(`#${id}`).value=job[key];
      modal.showModal();
    };
    if(me?.role==='client'){add.hidden=false;add.addEventListener('click',()=>open(null));}
    $('#job-editor-cancel').addEventListener('click',()=>modal.close());
    editJob=job=>open(job);
    deleteJob=async job=>{
      if(!confirm(`Видалити вакансію «${job.title}» разом із заявками?`))return;
      try{await api(`/api/jobs/${job.id}`,{method:'DELETE',body:{}});await refresh();}
      catch(error){notice(error.message);}
    };
    form.addEventListener('submit',async event=>{
      event.preventDefault();setText('job-form-error','');
      const body={};for(const [key,id] of Object.entries(fields))body[key]=value(id);
      const button=form.querySelector('[type=submit]');button.disabled=true;
      try {
        await api(editingId?`/api/jobs/${editingId}`:'/api/jobs', {method:editingId?'PATCH':'POST',body});
        modal.close();await refresh();
      } catch(error){setText('job-form-error',error.message);}finally{button.disabled=false;}
    });
  }

  async function initFreelancerDetail() {
    if(!$('#profile'))return;
    try {
      const id=params.get('id')||'1';
      const f=(await api(`/api/freelancers/${encodeURIComponent(id)}`)).item;
      setText('p-name',f.name);setText('p-desc',f.bio);setText('p-cat',labelCategory(f.category));setText('p-lvl',f.level);
      setText('p-rate',f.hourly_rate);setText('p-loc',f.location);setText('p-photo',initials(f.name));
      const st=$('#p-status');st.textContent=f.availability==='free'?'Free':'Busy';st.className='status status--'+f.availability;
      setText('p-rating',`★ ${f.rating}`);$('#p-rating').setAttribute('aria-label',`Рейтинг ${f.rating}`);
      const stack=$('#p-stack');stack.replaceChildren(...f.stack.map(t=>dom('li','',t)));
      $('#p-contact').href=me?`chat.html?with=${f.user_id}`:loginUrl(`chat.html?with=${f.user_id}`);
      document.title=f.name+' — Bounty Hunter';
    } catch(error){notice(error.message);}
  }
  async function initJobDetail() {
    if(!$('#job'))return;
    let j;
    try {
      const id=params.get('id')||'1';j=(await api(`/api/jobs/${encodeURIComponent(id)}`)).item;
      setText('j-title',j.title);setText('j-co',j.company);setText('j-cat',labelCategory(j.category));setText('j-lvl',j.level);
      setText('j-budget',j.budget);setText('j-deadline',j.deadline);setText('j-format',j.work_format);setText('j-logo',initials(j.company));
      $('#j-desc').replaceChildren(dom('p','',j.description));document.title=j.title+' — Bounty Hunter';
    } catch(error){notice(error.message);$('#apply-btn').disabled=true;return;}
    const modal=$('#apply-modal');
    const button=$('#apply-btn');
    if(me?.role==='client'){button.disabled=true;button.title='Відгукуватися можуть лише фрилансери';}
    button.addEventListener('click',()=>{
      if(!me){location.href=loginUrl(`job.html?id=${j.id}`);return;}
      if(me.role!=='freelancer')return;
      modal.showModal();$('#a-letter').focus();
    });
    $('#apply-cancel').addEventListener('click',()=>modal.close());
    $('#apply-form').addEventListener('submit',async event=>{
      event.preventDefault();
      const letter=value('a-letter'),expected_rate=value('a-rate');
      if(letter.length<10||expected_rate.length<2){alert('Супровідний лист — від 10 символів, ставка — від 2.');return;}
      try {
        const result=await api(`/api/jobs/${j.id}/applications`,{method:'POST',body:{letter,expected_rate}});
        location.href=`waiting.html?id=${result.item.id}`;
      } catch(error){alert(error.message);}
    });
  }
  async function initWaiting() {
    if(!$('#w-job'))return;
    const id=params.get('id');
    if(!id){setText('w-letter','Немає обраної заявки. Відкрийте «Мої заявки».');return;}
    try {
      const a=(await api(`/api/applications/${encodeURIComponent(id)}`)).item;
      setText('w-job',a.job_title);setText('w-letter',a.letter);setText('w-rate',a.expected_rate);
      $('#t').textContent=`Статус заявки: ${formatStatus(a.status)}`;
      $('.spinner')?.remove();
    } catch(error){setText('w-letter',error.message);}
  }
  async function initProfileEditor() {
    const form=$('#profile-form');if(!form)return;
    if(!me){notice('Потрібно увійти у свій акаунт.');return;}
    if(me.role!=='freelancer'){notice('Профіль доступний лише фрилансерам.');form.hidden=true;return;}
    try {
      const p=(await api('/api/profile/me')).item;
      for(const [key,id] of Object.entries({name:'pr-name',category:'pr-category',level:'pr-level',availability:'pr-availability',hourly_rate:'pr-rate',location:'pr-location',bio:'pr-bio'}))$('#'+id).value=p[key];
      $('#pr-stack').value=p.stack.join(', ');
    }catch(error){setText('profile-notice',error.message);}
    form.addEventListener('submit',async event=>{
      event.preventDefault();setText('profile-notice','');
      const stack=value('pr-stack').split(',').map(s=>s.trim()).filter(Boolean);
      const body={name:value('pr-name'),category:value('pr-category'),level:value('pr-level'),availability:value('pr-availability'),hourly_rate:value('pr-rate'),location:value('pr-location'),bio:value('pr-bio'),stack};
      try {await api('/api/profile/me',{method:'PATCH',body});setText('profile-notice','Профіль успішно збережено.');$('#profile-notice').classList.add('form-success');}
      catch(error){setText('profile-notice',error.message);$('#profile-notice').classList.remove('form-success');}
    });
  }
  async function initApplications() {
    const list=$('#applications-list');if(!list)return;
    if(!me){setText('applications-error','Потрібно увійти в акаунт.');return;}
    setText('application-hint',me.role==='client'?'Заявки на ваші вакансії (можна змінити статус).':'Ваші відгуки на вакансії та їхній статус.');
    async function refresh() {
      try {
        const data=await api('/api/applications/me');
        if(!data.items.length){list.replaceChildren(dom('p','empty','Заявок поки немає.'));return;}
        list.replaceChildren(...data.items.map(a=>{
          const card=dom('article','card');
          card.append(dom('h2','',a.job_title),dom('p','',`Заявка №${a.id} · ${me.role==='client'?a.applicant_username:'ваша заявка'}`),dom('p','',a.letter),dom('p','',`Ставка: ${a.expected_rate}`),dom('p','application-status',`Статус: ${formatStatus(a.status)}`));
          if(me.role==='client') {
            const row=dom('div','button-row');
            for(const [status,title] of [['accepted','Прийняти'],['rejected','Відхилити'],['pending','Повернути в очікування']]) {
              const button=dom('button','btn btn--outline',title);button.type='button';button.disabled=a.status===status;
              button.addEventListener('click',async()=>{try{await api(`/api/applications/${a.id}`,{method:'PATCH',body:{status}});await refresh();}catch(error){setText('applications-error',error.message);}});
              row.append(button);
            }
            card.append(row);
          } else card.append(link('Переглянути заявку',`waiting.html?id=${a.id}`));
          return card;
        }));
      }catch(error){setText('applications-error',error.message);}
    }
    refresh();
  }
  async function initChat() {
    const log=$('#chat-log');if(!log)return;
    const select=$('#chat-person'),input=$('#chat-input'),form=$('#chat-form');
    if(!me){log.replaceChildren(dom('p','','Щоб листуватися, увійдіть до акаунта.'));form.hidden=true;$('#chat-refresh').hidden=true;return;}
    let peerId=null;
    try {
      const contacts=(await api('/api/contacts')).items;
      select.replaceChildren(...contacts.map(c=>{
        const opt=dom('option','',`${c.name} (${c.role==='client'?'замовник':'фрилансер'})`);opt.value=String(c.id);return opt;
      }));
      const requested=params.get('with');
      const chosen=contacts.some(c=>String(c.id)===requested)?requested:String(contacts[0]?.id||'');
      if(!chosen){log.replaceChildren(dom('p','','Немає співрозмовників.'));form.hidden=true;return;}
      select.value=chosen;peerId=Number(chosen);
    }catch(error){log.replaceChildren(dom('p','form-error',error.message));form.hidden=true;return;}
    async function refresh() {
      if(!peerId)return;
      try {
        const result=await api(`/api/messages?with=${peerId}`);
        if(result.items.length===0){log.replaceChildren(dom('p','empty','Поки немає повідомлень. Напишіть першим.'));return;}
        log.replaceChildren(...result.items.map(m=>{
          const bubble=dom('div','bubble'+(m.sender_id===me.id?' bubble--out':''),m.content);
          const t=dom('time','',new Date(m.created_at).toLocaleString('uk-UA',{dateStyle:'short',timeStyle:'short'}));bubble.append(t);return bubble;
        }));
        log.scrollTop=log.scrollHeight;
      }catch(error){log.replaceChildren(dom('p','form-error',error.message));}
    }
    select.addEventListener('change',()=>{
      peerId=Number(select.value);
      const opt=select.selectedOptions[0];setText('c-name',opt?.textContent||'Чат');setText('c-avatar',initials(opt?.textContent||'BH'));
      history.replaceState(null,'',`chat.html?with=${peerId}`);refresh();
    });
    select.dispatchEvent(new Event('change'));
    $('#chat-refresh').addEventListener('click',refresh);
    form.addEventListener('submit',async event=>{
      event.preventDefault();const content=input.value.trim();if(!content)return;
      if(content.length>2000){notice('До 2000 символів у повідомленні.');return;}
      const button=form.querySelector('[type=submit]');button.disabled=true;
      try {await api('/api/messages',{method:'POST',body:{recipient_id:peerId,content}});input.value='';await refresh();}
      catch(error){notice(error.message);}finally{button.disabled=false;}
    });
    input.addEventListener('keydown',event=>{if(event.key==='Enter'&&!event.shiftKey){event.preventDefault();form.requestSubmit();}});
  }
  function initHelp() {
    const form=$('#help-form');if(!form)return;
    form.addEventListener('submit',async event=>{
      event.preventDefault();setText('help-note','');
      const body=value('h-msg');if(body.length<10){setText('help-note','Опишіть проблему (від 10 символів).');return;}
      try {const response=await api('/api/support',{method:'POST',body:{body}});setText('help-note',`Звернення №${response.id} збережено. Це навчальний демонстраційний сервіс без операторів підтримки.`);form.reset();}
      catch(error){setText('help-note',error.message);}
    });
  }
  async function main() {
    await initNav();
    initAuth();initLists();initHelp();
    await Promise.all([initFreelancerDetail(),initJobDetail(),initWaiting(),initProfileEditor(),initApplications(),initChat()]);
  }
  main().catch(error=>{console.error(error);notice(error.message);});
})();
