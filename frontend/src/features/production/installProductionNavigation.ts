export function installProductionNavigation(){
 const add=()=>{
  if(document.querySelector('[data-production-link]'))return
  const nav=document.querySelector('nav')||document.querySelector('aside')
  if(!nav)return
  const link=document.createElement('a');link.href='/production.html';link.textContent='Produzione';link.setAttribute('data-production-link','true');link.style.cssText='display:block;padding:10px 12px;margin:6px;color:inherit;text-decoration:none;border-radius:8px;background:rgba(255,255,255,.06)';nav.appendChild(link)
 }
 add();new MutationObserver(add).observe(document.body,{childList:true,subtree:true})
}
