/* 通用确认框：App 内样式，替代浏览器原生 confirm */
let confirmResolve = null;

function askConfirm(title, desc, okText) {
  return new Promise(resolve => {
    $('confirmTitle').textContent = title || '确认';
    $('confirmDesc').textContent = desc || '';
    $('btnConfirmYes').textContent = okText || '确定';
    confirmResolve = resolve;
    openModal('modalConfirm');
  });
}

function settleConfirm(result) {
  const r = confirmResolve;
  confirmResolve = null;
  closeModal();
  if (r) r(result);
}
