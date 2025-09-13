class MerchantUdidSetup {
  constructor() {
    this.params = new URLSearchParams(window.location.search);
    this.merchantId = this.params.get('merchant_id') || '';
    this.adminKey = (window.adminUtils?.adminKey) || this.params.get('key') || '';
    this.init();
  }

  async init() {
    if (!this.merchantId) {
      this.setStatus('لم يتم تمرير معرف التاجر', 'error');
      return;
    }
    document.getElementById('merchantId').textContent = this.merchantId;

    document.getElementById('generateBtn').addEventListener('click', () => this.generate());
    document.getElementById('copyBtn').addEventListener('click', () => this.copy());
    document.getElementById('goManage').addEventListener('click', () => this.goManage());

    await this.loadMerchant();
    await this.loadOrShowUdid();
  }

  async loadMerchant() {
    try {
      const csrf = window.adminUtils?.getCsrfToken ? window.adminUtils.getCsrfToken() : '';
      const res = await fetch(`/api/merchants/${this.merchantId}`, {
        credentials: 'include',
        headers: Object.assign({}, this.adminKey ? { 'Authorization': `Bearer ${this.adminKey}` } : {})
      });
      const data = await res.json();
      if (res.ok && data.success) {
        document.getElementById('merchantName').textContent = data.merchant?.business_name || '—';
        // Try to show existing udid from settings
        const settings = data.merchant?.settings || {};
        const udid = settings?.integration?.udid;
        if (udid) this.renderUdid(udid);
      }
    } catch (e) {
      this.setStatus('تعذر تحميل بيانات التاجر', 'error');
    }
  }

  async loadOrShowUdid() {
    try {
      const current = (document.getElementById('udidBox').textContent || '').trim();
      const looksLikeUuid = current && current.includes('-') && current.length >= 30;
      if (!looksLikeUuid) {
        this.setStatus('جارِ توليد UDID تلقائياً...', 'muted');
        await this.generate();
      } else {
        this.setStatus('UDID جاهز', 'ok');
      }
    } catch {}
  }

  async generate() {
    try {
      const csrf = window.adminUtils?.getCsrfToken ? window.adminUtils.getCsrfToken() : '';
      const res = await fetch(`/api/merchants/${this.merchantId}/udid`, {
        method: 'POST',
        headers: Object.assign(
          { 'Content-Type': 'application/json' },
          this.adminKey ? { 'Authorization': `Bearer ${this.adminKey}` } : {},
          csrf ? { 'X-CSRF-Token': csrf } : {}
        ),
        credentials: 'include',
        body: JSON.stringify({})
      });
      const data = await res.json();
      if (res.ok && data.success) {
        this.renderUdid(data.udid);
        this.setStatus(data.regenerated ? 'تم تحديث UDID بنجاح' : 'تم توليد UDID بنجاح', 'ok');
        if (window.adminUtils) window.adminUtils.showToast('تم توليد UDID بنجاح', 'success');
      } else {
        throw new Error(data.error || 'فشل توليد UDID');
      }
    } catch (e) {
      this.setStatus('فشل توليد UDID', 'error');
      if (window.adminUtils) window.adminUtils.showToast('فشل توليد UDID', 'error');
    }
  }

  renderUdid(udid) {
    document.getElementById('udidBox').textContent = udid;
  }

  async copy() {
    const t = document.getElementById('udidBox').textContent.trim();
    if (!t || t === 'غير مُنشأ بعد') return;
    try {
      await navigator.clipboard.writeText(t);
      this.setStatus('تم نسخ UDID', 'ok');
      if (window.adminUtils) window.adminUtils.showToast('تم نسخ UDID', 'success');
    } catch (e) {
      this.setStatus('تعذر نسخ UDID', 'error');
    }
  }

  goManage() {
    window.location.href = `/admin/merchants`;
  }

  setStatus(msg, type) {
    const el = document.getElementById('statusMsg');
    el.textContent = msg;
    el.className = type === 'ok' ? 'ok' : (type === 'error' ? 'error' : 'muted');
  }
}

document.addEventListener('DOMContentLoaded', () => new MerchantUdidSetup());
