/**
 * ===============================================
 * JavaScript for Merchant Entry Page
 * وظائف JavaScript لصفحة إدخال بيانات التاجر
 * ===============================================
 */

class MerchantEntryManager {
    constructor() {
        this.productCount = 0;
        this.workingHours = {};
        this.init();
    }

    init() {
        this.setupWorkingHours();
        this.setupEventListeners();
        this.setupFormValidation();
        this.updateCompletenessScore();
        this.updateUdidGate();
    }

    // Setup working hours interface
    setupWorkingHours() {
        const days = [
            { key: 'sunday', name: 'الأحد' },
            { key: 'monday', name: 'الاثنين' },
            { key: 'tuesday', name: 'الثلاثاء' },
            { key: 'wednesday', name: 'الأربعاء' },
            { key: 'thursday', name: 'الخميس' },
            { key: 'friday', name: 'الجمعة' },
            { key: 'saturday', name: 'السبت' }
        ];

        const container = document.getElementById('workingHours');
        container.innerHTML = '';

        days.forEach(day => {
            const dayDiv = document.createElement('div');
            dayDiv.className = 'day-schedule';
            dayDiv.innerHTML = `
                <h4>${day.name}</h4>
                <div class="day-toggle">
                    <div class="toggle-switch" data-day="${day.key}"></div>
                    <span>مفتوح</span>
                </div>
                <div class="time-inputs">
                    <input type="time" name="working_hours[${day.key}][open]" value="10:00">
                    <span>إلى</span>
                    <input type="time" name="working_hours[${day.key}][close]" value="22:00">
                </div>
            `;

            // Setup toggle functionality
            const toggle = dayDiv.querySelector('.toggle-switch');
            const timeInputs = dayDiv.querySelector('.time-inputs');
            
            toggle.addEventListener('click', () => {
                toggle.classList.toggle('active');
                const isActive = toggle.classList.contains('active');
                timeInputs.style.opacity = isActive ? '1' : '0.5';
                timeInputs.style.pointerEvents = isActive ? 'auto' : 'none';
                
                // Update working hours data
                this.workingHours[day.key] = {
                    enabled: isActive,
                    open: isActive ? timeInputs.querySelector('input[type="time"]:first-child').value : '10:00',
                    close: isActive ? timeInputs.querySelector('input[type="time"]:last-child').value : '22:00'
                };
                
                this.updateCompletenessScore();
            });

            // Setup time change listeners
            timeInputs.querySelectorAll('input[type="time"]').forEach(input => {
                input.addEventListener('change', () => {
                    if (toggle.classList.contains('active')) {
                        this.workingHours[day.key] = {
                            enabled: true,
                            open: timeInputs.querySelector('input[type="time"]:first-child').value,
                            close: timeInputs.querySelector('input[type="time"]:last-child').value
                        };
                        this.updateCompletenessScore();
                    }
                });
            });

            container.appendChild(dayDiv);
        });

        // Set default working hours (Sunday-Thursday open, Friday open, Saturday closed)
        const defaultDays = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday'];
        defaultDays.forEach(dayKey => {
            const toggle = container.querySelector(`[data-day="${dayKey}"]`);
            if (toggle) {
                toggle.classList.add('active');
                this.workingHours[dayKey] = {
                    enabled: true,
                    open: '10:00',
                    close: dayKey === 'friday' ? '22:00' : '22:00'
                };
            }
        });
    }

    // Setup event listeners
    setupEventListeners() {
        // Add product button
        document.getElementById('addProductBtn').addEventListener('click', () => {
            if (!this.isUdidProvided()) {
                if (window.adminUtils) window.adminUtils.showToast('يرجى إدخال ManyChat UDID أولاً', 'warning');
                this.scrollToUdid();
                return;
            }
            this.addProduct();
        });

        // UDID gating
        const udidInput = document.getElementById('manychat_udid');
        if (udidInput) {
            udidInput.addEventListener('input', () => this.updateUdidGate());
            udidInput.addEventListener('blur', () => this.updateUdidGate());
        }

        // Temperature slider
        const temperatureSlider = document.getElementById('ai_temperature');
        const temperatureValue = document.getElementById('temperatureValue');
        
        temperatureSlider.addEventListener('input', (e) => {
            temperatureValue.textContent = e.target.value;
        });

        // Form submission
        document.getElementById('merchantForm').addEventListener('submit', (e) => {
            e.preventDefault();
            this.submitForm();
        });

        // Floating CTA submit
        const floatingBtn = document.getElementById('submitFloatingBtn');
        if (floatingBtn) {
            floatingBtn.addEventListener('click', () => {
                document.getElementById('merchantForm')?.requestSubmit();
            });
        }

        // Manage merchants navigation (ensures admin session cookie then redirects)
        const manageBtn = document.getElementById('manageMerchantsBtn');
        if (manageBtn) {
            manageBtn.addEventListener('click', async () => {
                try {
                    const adminKey = window.adminUtils?.adminKey || '';
                    if (!adminKey) {
                        if (window.adminUtils) window.adminUtils.showToast('يرجى إضافة ?key=ADMIN_KEY إلى الرابط أولاً', 'warning');
                        return;
                    }
                    // Establish admin session cookie for GET-protected routes
                    await fetch('/admin/login', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        credentials: 'include',
                        body: JSON.stringify({ key: adminKey })
                    });
                    // Redirect with key so page JS can use it for API calls
                    const target = `/admin/merchants?key=${encodeURIComponent(adminKey)}`;
                    window.location.href = target;
                } catch (e) {
                    if (window.adminUtils) window.adminUtils.showToast('تعذر فتح إدارة التجار', 'error');
                    console.error('Failed to open management', e);
                }
            });
        }

        // Real-time validation
        document.querySelectorAll('input, select, textarea').forEach(input => {
            input.addEventListener('input', () => {
                this.updateCompletenessScore();
            });
        });
    }

    // Check UDID provided
    isUdidProvided() {
        const v = document.getElementById('manychat_udid')?.value || '';
        return v.trim().length > 0;
    }

    // Update gating for products/images until UDID is filled
    updateUdidGate() {
        const hasUdid = this.isUdidProvided();
        const addBtn = document.getElementById('addProductBtn');
        const note = document.getElementById('productsGateNote');
        if (addBtn) {
            addBtn.disabled = !hasUdid;
            addBtn.style.opacity = hasUdid ? '1' : '0.6';
            addBtn.style.cursor = hasUdid ? 'pointer' : 'not-allowed';
        }
        if (note) note.style.display = hasUdid ? 'none' : 'block';
    }

    scrollToUdid() {
        const el = document.getElementById('manychat_udid');
        if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }

    // Setup form validation
    setupFormValidation() {
        const form = document.getElementById('merchantForm');
        
        // Real-time validation via AdminUtils
        form.addEventListener('input', (e) => {
            const el = e.target;
            if (!(window.adminUtils && el instanceof HTMLElement)) return;
            const name = el.getAttribute('name') || el.id || '';
            let rules = {};
            switch (name) {
                case 'business_name': rules = { required: true, minLength: 2, maxLength: 255 }; break;
                case 'whatsapp_number': rules = { required: true, phone: true }; break;
                case 'email': rules = { email: true, maxLength: 255 }; break;
                case 'manychat_udid': rules = { required: true, minLength: 5, maxLength: 255 }; break;
                default: rules = {};
            }
            if (Object.keys(rules).length > 0) window.adminUtils.validateField(el, rules);
        });
    }

    // Validate individual field
    validateField(field) {
        const value = field.value.trim();
        const isValid = value.length > 0;
        
        if (isValid) {
            field.style.borderColor = '#28a745';
        } else {
            field.style.borderColor = '#dc3545';
        }
        
        return isValid;
    }

    // Add new product
    addProduct() {
        this.productCount++;
        const container = document.getElementById('productsContainer');
        
        // Generate automatic SKU preferring first two letters of Instagram username
        const igUser = (document.getElementById('instagram_username')?.value || '').trim();
        const igPrefix = igUser
            .replace(/^@/, '') // remove leading @ if provided
            .replace(/[^a-zA-Z]/g, '') // keep only letters for IG prefix
            .substring(0, 2)
            .toUpperCase();
        const businessName = document.getElementById('business_name')?.value || '';
        const bnPrefix = businessName
            .replace(/[^a-zA-Z0-9\u0600-\u06FF]/g, '') // allow letters (incl. Arabic) and digits
            .substring(0, 2)
            .toUpperCase();
        const merchantPrefix = igPrefix || bnPrefix;
        const randomDigits = Math.floor(1000 + Math.random() * 9000);
        const autoSku = merchantPrefix ? `${merchantPrefix}${randomDigits}` : `PROD${randomDigits}`;
        
        const productDiv = document.createElement('div');
        productDiv.className = 'product-item';
        productDiv.innerHTML = `
            <div class="product-header">
                <h3>منتج ${this.productCount}</h3>
                <button type="button" class="remove-product" onclick="merchantManager.removeProduct(this)">
                    <i class="fas fa-trash"></i> حذف
                </button>
            </div>
            
            <div class="form-row">
                <div class="form-group">
                    <label>رمز المنتج (SKU) <span class="required">*</span></label>
                    <input type="text" name="products[${this.productCount}][sku]" required 
                           value="${autoSku}" placeholder="سيتم توليده تلقائياً">
                </div>
                <div class="form-group">
                    <label>اسم المنتج (عربي) <span class="required">*</span></label>
                    <input type="text" name="products[${this.productCount}][name_ar]" required 
                           placeholder="مثال: قميص قطني">
                </div>
            </div>
            
            <div class="form-row">
                <div class="form-group">
                    <label>اسم المنتج (إنجليزي)</label>
                    <input type="text" name="products[${this.productCount}][name_en]" 
                           placeholder="مثال: Cotton Shirt">
                </div>
                <div class="form-group">
                    <label>الفئة</label>
                    <select name="products[${this.productCount}][category]">
                        <option value="general">عام</option>
                        <option value="fashion">أزياء</option>
                        <option value="electronics">إلكترونيات</option>
                        <option value="beauty">جمال</option>
                        <option value="home">منزل</option>
                        <option value="sports">رياضة</option>
                        <option value="grocery">مواد غذائية</option>
                        <option value="automotive">سيارات</option>
                        <option value="health">صحة</option>
                        <option value="education">تعليم</option>
                    </select>
                </div>
            </div>
            
            <div class="form-group">
                <label>وصف المنتج</label>
                <textarea name="products[${this.productCount}][description_ar]" rows="3"
                          placeholder="وصف مختصر للمنتج..."></textarea>
            </div>
            
            <div class="form-row">
                <div class="form-group">
                    <label>السعر (دولار) <span class="required">*</span></label>
                    <input type="number" name="products[${this.productCount}][price_usd]" 
                           step="0.01" min="0" required placeholder="0.00">
                </div>
                <div class="form-group">
                    <label>الكمية المتوفرة</label>
                    <input type="number" name="products[${this.productCount}][stock_quantity]" 
                           min="0" value="0" placeholder="0">
                </div>
            </div>
            
            <div class="form-group">
                <label>العلامات (Tags)</label>
                <input type="text" name="products[${this.productCount}][tags]" 
                       placeholder="مثال: رجالي، قطني، صيفي (مفصولة بفواصل)">
            </div>
            
            <div class="form-group">
                <label>صورة المنتج</label>
                <div class="image-upload" onclick="merchantManager.uploadProductImage(this, ${this.productCount})">
                    <i class="fas fa-cloud-upload-alt"></i>
                    <div class="upload-text">رفع صورة المنتج</div>
                    <div class="upload-hint">JPG, PNG, GIF (حد أقصى 5MB)</div>
                    <button type="button" class="upload-btn">
                        <i class="fas fa-upload"></i>
                        اختيار صورة
                    </button>
                </div>
                <div class="image-preview">
                    <div class="preview-actions">
                        <button type="button" class="preview-btn change" onclick="merchantManager.changeProductImage(this)">
                            <i class="fas fa-edit"></i> تغيير
                        </button>
                        <button type="button" class="preview-btn remove" onclick="merchantManager.removeProductImage(this)">
                            <i class="fas fa-trash"></i> حذف
                        </button>
                    </div>
                </div>
                <input type="hidden" name="products[${this.productCount}][image_url]">
            </div>
        `;
        
        container.appendChild(productDiv);
        
        // Add animation
        productDiv.style.opacity = '0';
        productDiv.style.transform = 'translateY(20px)';
        setTimeout(() => {
            productDiv.style.transition = 'all 0.3s ease';
            productDiv.style.opacity = '1';
            productDiv.style.transform = 'translateY(0)';
        }, 100);
        
        this.updateCompletenessScore();

        // Wire upload button click explicitly
        const uploadDiv = productDiv.querySelector('.image-upload');
        const uploadBtn = productDiv.querySelector('.upload-btn');
        if (uploadDiv && uploadBtn) {
            uploadBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                if (!this.isUdidProvided()) {
                    if (window.adminUtils) window.adminUtils.showToast('يرجى إدخال ManyChat UDID أولاً', 'warning');
                    this.scrollToUdid();
                    return;
                }
                this.uploadProductImage(uploadDiv, this.productCount);
            });
        }
    }

    // Remove product
    removeProduct(button) {
        const productItem = button.closest('.product-item');
        if (productItem && confirm('هل أنت متأكد من حذف هذا المنتج؟')) {
            productItem.style.transition = 'all 0.3s ease';
            productItem.style.opacity = '0';
            productItem.style.transform = 'translateY(-20px)';
            
            setTimeout(() => {
                productItem.remove();
                this.updateProductNumbers();
                this.updateCompletenessScore();
            }, 300);
        }
    }

    // Update product numbers after deletion
    updateProductNumbers() {
        const products = document.querySelectorAll('.product-item');
        products.forEach((product, index) => {
            const header = product.querySelector('.product-header h3');
            if (header) {
                header.textContent = `منتج ${index + 1}`;
            }
        });
        this.productCount = products.length;
    }

    // Upload product image
    async uploadProductImage(uploadDiv, productIndex) {
        if (!this.isUdidProvided()) {
            if (window.adminUtils) window.adminUtils.showToast('يرجى إدخال ManyChat UDID أولاً', 'warning');
            this.scrollToUdid();
            return;
        }
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = 'image/*';
        input.style.display = 'none';
        
        input.addEventListener('change', async (e) => {
            const file = e.target.files[0];
            if (file) {
                await this.processImageUpload(file, uploadDiv);
            }
        });
        
        document.body.appendChild(input);
        input.click();
        document.body.removeChild(input);
    }

    // Process image upload
    async processImageUpload(file, uploadDiv) {
        // Validate file size (5MB max)
        if (file.size > 5 * 1024 * 1024) {
            if (window.adminUtils) { window.adminUtils.showToast('حجم الملف كبير جداً. الحد الأقصى 5MB', 'error'); } else { alert('حجم الملف كبير جداً. الحد الأقصى 5MB'); }
            return;
        }
        
        // Validate file type
        if (!file.type.startsWith('image/')) {
            if (window.adminUtils) { window.adminUtils.showToast('يرجى اختيار ملف صورة صحيح', 'error'); } else { alert('يرجى اختيار ملف صورة صحيح'); }
            return;
        }
        
        // Show loading
        uploadDiv.innerHTML = '<i class="fas fa-spinner fa-spin"></i><div class="upload-text">جاري رفع الصورة...</div>';
        
        try {
            // Upload to server
            const formData = new FormData();
            formData.append('file', file);
            
            const csrf = window.adminUtils?.getCsrfToken ? window.adminUtils.getCsrfToken() : '';
            const response = await fetch('/admin/upload', {
                method: 'POST',
                headers: Object.assign({}, csrf ? { 'X-CSRF-Token': csrf } : {}),
                credentials: 'include',
                body: formData
            });
            
            const result = await response.json();
            
            if (response.ok && result.success) {
                // Show preview
                const preview = uploadDiv.nextElementSibling;
                preview.style.display = 'block';
                const name = (document.querySelector('[name="products['+this.productCount+'][name_ar]"]')?.value || '').trim();
                preview.innerHTML = `
                    <img src="${result.url}" alt="صورة المنتج ${name || ''}" role="img">
                    <div class="preview-actions">
                        <button type="button" class="preview-btn change" onclick="merchantManager.changeProductImage(this)">
                            <i class="fas fa-edit"></i> تغيير
                        </button>
                        <button type="button" class="preview-btn remove" onclick="merchantManager.removeProductImage(this)">
                            <i class="fas fa-trash"></i> حذف
                        </button>
                    </div>
                `;
                
                // Store image URL
                const hiddenInput = uploadDiv.parentElement.querySelector('input[type="hidden"]');
                hiddenInput.value = result.url;
                
                // Update upload div to success state
                uploadDiv.innerHTML = '<i class="fas fa-check-circle"></i><div class="upload-text">تم رفع الصورة بنجاح</div>';
                uploadDiv.style.borderColor = '#28a745';
                uploadDiv.style.background = 'linear-gradient(135deg, #d4edda 0%, #c3e6cb 100%)';
                
            } else {
                throw new Error(result.error || 'فشل في رفع الصورة');
            }
        } catch (error) {
            if (window.adminUtils) { window.adminUtils.showToast('حدث خطأ في رفع الصورة: ' + error.message, 'error'); } else { alert('حدث خطأ في رفع الصورة: ' + error.message); }
            this.resetUploadDiv(uploadDiv);
        }
    }

    // Change product image
    changeProductImage(button) {
        const productItem = button.closest('.product-item');
        const uploadDiv = productItem.querySelector('.image-upload');
        this.uploadProductImage(uploadDiv, 0);
    }

    // Remove product image
    removeProductImage(button) {
        if (confirm('هل أنت متأكد من حذف هذه الصورة؟')) {
            const productItem = button.closest('.product-item');
            const uploadDiv = productItem.querySelector('.image-upload');
            const preview = productItem.querySelector('.image-preview');
            const hiddenInput = productItem.querySelector('input[type="hidden"]');
            
            // Reset everything
            preview.style.display = 'none';
            preview.innerHTML = '';
            hiddenInput.value = '';
            this.resetUploadDiv(uploadDiv);
        }
    }

    // Reset upload div to initial state
    resetUploadDiv(uploadDiv) {
        uploadDiv.innerHTML = `
            <i class="fas fa-cloud-upload-alt"></i>
            <div class="upload-text">رفع صورة المنتج</div>
            <div class="upload-hint">JPG, PNG, GIF (حد أقصى 5MB)</div>
            <button type="button" class="upload-btn">
                <i class="fas fa-upload"></i>
                اختيار صورة
            </button>
        `;
        uploadDiv.style.borderColor = '#1e3c72';
        uploadDiv.style.background = 'linear-gradient(135deg, #f8f9ff 0%, #e8f2ff 100%)';
    }

    // Generate UUID
    generateUUID() {
        return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
            const r = Math.random() * 16 | 0;
            const v = c == 'x' ? r : (r & 0x3 | 0x8);
            return v.toString(16);
        });
    }

    // Copy merchant ID to clipboard
    copyMerchantId() {
        const merchantIdValue = document.getElementById('merchantIdValue').textContent;
        
        if (navigator.clipboard) {
            navigator.clipboard.writeText(merchantIdValue).then(() => {
                // Show success feedback
                const copyBtn = document.querySelector('.copy-btn');
                const originalText = copyBtn.innerHTML;
                copyBtn.innerHTML = '<i class="fas fa-check"></i> تم النسخ';
                copyBtn.style.background = 'rgba(40, 167, 69, 0.3)';
                
                setTimeout(() => {
                    copyBtn.innerHTML = originalText;
                    copyBtn.style.background = 'rgba(255,255,255,0.3)';
                }, 2000);
            }).catch(() => {
                this.fallbackCopyToClipboard(merchantIdValue);
            });
        } else {
            this.fallbackCopyToClipboard(merchantIdValue);
        }
    }

    // Fallback copy method
    fallbackCopyToClipboard(text) {
        const textArea = document.createElement('textarea');
        textArea.value = text;
        textArea.style.position = 'fixed';
        textArea.style.left = '-999999px';
        textArea.style.top = '-999999px';
        document.body.appendChild(textArea);
        textArea.focus();
        textArea.select();
        
        try {
            document.execCommand('copy');
            alert('تم نسخ معرف التاجر بنجاح');
        } catch (err) {
            alert('فشل في نسخ المعرف. يرجى نسخه يدوياً');
        }
        
        document.body.removeChild(textArea);
    }

    // Calculate completeness score
    calculateCompletenessScore() {
        const requiredFields = [
            'business_name',
            'business_category',
            'whatsapp_number',
            'currency'
        ];

        const importantFields = [
            'instagram_username',
            'email',
            'business_address',
            'ai_model',
            'welcome_message',
            'fallback_message'
        ];

        let score = 0;
        let totalWeight = 0;

        // Check required fields (weight 3)
        requiredFields.forEach(fieldName => {
            totalWeight += 3;
            const field = document.querySelector(`[name="${fieldName}"]`);
            if (field && field.value.trim() !== '') {
                score += 3;
            }
        });

        // Check important fields (weight 2)
        importantFields.forEach(fieldName => {
            totalWeight += 2;
            const field = document.querySelector(`[name="${fieldName}"]`);
            if (field && field.value.trim() !== '') {
                score += 2;
            }
        });

        // Check working hours (weight 2)
        totalWeight += 2;
        const hasWorkingHours = Object.values(this.workingHours).some(day => day.enabled);
        if (hasWorkingHours) {
            score += 2;
        }

        // Check payment methods (weight 2)
        totalWeight += 2;
        const paymentMethods = document.querySelectorAll('input[name="payment_methods"]:checked');
        if (paymentMethods.length > 0) {
            score += 2;
        }

        // Check products (weight 1)
        totalWeight += 1;
        if (this.productCount > 0) {
            score += 1;
        }

        const percentage = Math.round((score / totalWeight) * 100);
        return percentage;
    }

    // Update completeness score display
    updateCompletenessScore() {
        const score = this.calculateCompletenessScore();
        const scoreElement = document.getElementById('completenessScore');
        const progressFill = document.getElementById('progressFill');
        
        scoreElement.textContent = `${score}%`;
        progressFill.style.width = `${score}%`;
        
        // Change color based on score
        if (score >= 90) {
            progressFill.style.background = 'linear-gradient(90deg, #28a745, #20c997)';
        } else if (score >= 75) {
            progressFill.style.background = 'linear-gradient(90deg, #ffc107, #fd7e14)';
        } else if (score >= 60) {
            progressFill.style.background = 'linear-gradient(90deg, #fd7e14, #dc3545)';
        } else {
            progressFill.style.background = 'linear-gradient(90deg, #dc3545, #6f42c1)';
        }
    }

    // Validate form data
    validateFormData(data) {
        const errors = [];
        
        // Required fields validation
        if (!data.business_name || data.business_name.trim() === '') {
            errors.push('اسم العمل مطلوب');
        }
        
        if (!data.business_category || data.business_category === '') {
            errors.push('فئة العمل مطلوبة');
        }
        
        if (!data.whatsapp_number || data.whatsapp_number.trim() === '') {
            errors.push('رقم الواتساب مطلوب');
        }

        // ManyChat UDID required (for gating products/images)
        if (!data.manychat_udid || data.manychat_udid.trim() === '') {
            errors.push('ManyChat UDID مطلوب');
        }
        
        // WhatsApp number format validation
        if (data.whatsapp_number && !/^\+?[1-9]\d{1,14}$/.test(data.whatsapp_number.replace(/\s/g, ''))) {
            errors.push('رقم الواتساب غير صحيح');
        }
        
        // Email validation
        if (data.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.email)) {
            errors.push('البريد الإلكتروني غير صحيح');
        }
        
        // Instagram username validation
        if (data.instagram_username && !/^[a-zA-Z0-9._]+$/.test(data.instagram_username)) {
            errors.push('اسم المستخدم في إنستغرام غير صحيح');
        }
        
        return errors;
    }

    // Collect form data
    collectFormData() {
        const formData = new FormData(document.getElementById('merchantForm'));
        const data = {};
        
        // Basic form data
        for (const [key, value] of formData.entries()) {
            if (key.startsWith('products[')) {
                // Handle products separately
                continue;
            } else if (key.startsWith('working_hours[')) {
                // Handle working hours separately
                continue;
            } else if (key === 'payment_methods') {
                // Handle payment methods as array
                if (!data.payment_methods) data.payment_methods = [];
                data.payment_methods.push(value);
            } else {
                data[key] = value;
            }
        }
        
        // Add working hours
        data.working_hours = {
            enabled: true,
            timezone: data.timezone || 'Asia/Baghdad',
            schedule: this.workingHours
        };
        
        // Add AI config
        data.ai_config = {
            model: data.ai_model || 'gpt-4o-mini',
            language: 'ar',
            temperature: parseFloat(data.ai_temperature) || 0.7,
            max_tokens: parseInt(data.ai_max_tokens) || 600,
            tone: data.ai_tone || 'friendly',
            product_hints: true,
            auto_responses: true
        };
        
        // Add response templates
        data.response_templates = {
            welcome_message: data.welcome_message || 'أهلاً بك! كيف يمكنني مساعدتك اليوم؟',
            fallback_message: data.fallback_message || 'واضح! أعطيني تفاصيل أكثر وسأساعدك فوراً.',
            outside_hours_message: data.outside_hours_message || 'نرحب برسالتك، سنعود لك بأقرب وقت ضمن ساعات الدوام.'
        };
        
        // Add products
        if (this.productCount > 0) {
            data.products = [];
            for (let i = 1; i <= this.productCount; i++) {
                const productData = {};
                for (const [key, value] of formData.entries()) {
                    if (key.startsWith(`products[${i}][`)) {
                        const fieldName = key.match(/\[([^\]]+)\]$/)[1];
                        productData[fieldName] = value;
                    }
                }
                
                if (productData.name_ar) {
                    // Generate automatic SKU if not provided
                    let productSku = productData.sku;
                    if (!productSku || productSku.trim() === '') {
                        const igPrefix = String(data.instagram_username || '')
                            .replace(/^@/, '')
                            .replace(/[^a-zA-Z]/g, '')
                            .substring(0, 2)
                            .toUpperCase();
                        const bnPrefix = String(data.business_name || '')
                            .replace(/[^a-zA-Z0-9\u0600-\u06FF]/g, '')
                            .substring(0, 2)
                            .toUpperCase();
                        const merchantPrefix = igPrefix || bnPrefix;
                        const randomDigits = Math.floor(1000 + Math.random() * 9000);
                        productSku = merchantPrefix ? `${merchantPrefix}${randomDigits}` : `PROD${randomDigits}`;
                    }
                    
                    data.products.push({
                        sku: productSku,
                        name_ar: productData.name_ar,
                        name_en: productData.name_en || '',
                        description_ar: productData.description_ar || '',
                        category: productData.category || 'general',
                        price_usd: parseFloat(productData.price_usd) || 0,
                        stock_quantity: parseInt(productData.stock_quantity) || 0,
                        tags: productData.tags ? productData.tags.split(',').map(tag => tag.trim()) : [],
                        image_url: productData.image_url || null,
                        is_active: true
                    });
                }
            }
        }
        
        return data;
    }

    // Submit form
    async submitForm() {
        const loadingDiv = document.getElementById('loading');
        const successDiv = document.getElementById('success');
        const errorDiv = document.getElementById('error');
        const submitBtn = document.getElementById('submitBtn');
        
        // Show loading
        loadingDiv.style.display = 'block';
        successDiv.style.display = 'none';
        errorDiv.style.display = 'none';
        submitBtn.disabled = true;
        
        try {
            // Collect and validate data
            const data = this.collectFormData();
            const errors = this.validateFormData(data);
            
            if (errors.length > 0) {
                throw new Error(errors.join('\n'));
            }
            
            // Submit to server with admin authentication
            const adminKey = window.adminUtils?.adminKey || '';
            console.log('Using admin key:', adminKey);
            const response = await fetch('/admin/merchants', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': 'Bearer ' + adminKey
                },
                body: JSON.stringify(data)
            });
            
            const result = await response.json();
            
            loadingDiv.style.display = 'none';
            
            if (response.ok && result.success) {
                const merchantId = result.merchant_id;
                // Optional toast only (لا نعرض نجاحاً كبيراً في هذه الصفحة)
                if (window.adminUtils) {
                    window.adminUtils.showToast('تم إنشاء التاجر، جاري إكمال الإعداد...', 'success', 4000);
                }
                // إبقاء مؤشر التحميل ظاهر حتى التحويل
                loadingDiv.style.display = 'block';
                // إنشاء جلسة مدير لصفحات /admin ثم التحويل لصفحة إعداد UDID مع تمرير المفتاح
                try {
                    await fetch('/admin/login', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        credentials: 'include',
                        body: JSON.stringify({ key: adminKey })
                    });
                } catch {}
                // تحويل سريع لصفحة إعداد UDID
                const nextUrl = `/admin/merchants/udid-setup?merchant_id=${encodeURIComponent(merchantId)}${adminKey ? `&key=${encodeURIComponent(adminKey)}` : ''}`;
                window.location.href = nextUrl;
            } else {
                // Prefer detailed validation errors, then error, then message
                let composedMessage = '';
                if (result && Array.isArray(result.details) && result.details.length) {
                    composedMessage = 'تحقق من البيانات: ' + result.details.join('، ');
                } else {
                    composedMessage = (result && (result.error || result.message)) || 'حدث خطأ غير متوقع';
                }

                if (window.adminUtils) {
                    window.adminUtils.showToast(composedMessage, 'error');
                } else {
                    console.error('خطأ:', composedMessage);
                }

                errorDiv.style.display = 'block';
                document.getElementById('errorMessage').textContent = composedMessage;
            }
            
        } catch (error) {
            loadingDiv.style.display = 'none';
            
            // Use admin utils for error message
            if (window.adminUtils) {
                window.adminUtils.showToast('حدث خطأ في الاتصال: ' + error.message, 'error');
            } else {
                console.error('خطأ في الاتصال:', error.message);
            }
            
            errorDiv.style.display = 'block';
            document.getElementById('errorMessage').textContent = 
                'حدث خطأ في الاتصال: ' + error.message;
        } finally {
            // Use admin utils to reset button state
            if (window.adminUtils) {
                window.adminUtils.setButtonLoading(submitBtn, false);
            } else {
                submitBtn.disabled = false;
                submitBtn.textContent = 'إنشاء التاجر';
            }
        }
    }
}

// Initialize when page loads (export to window for accessibility)
document.addEventListener('DOMContentLoaded', () => {
    window.merchantManager = new MerchantEntryManager();
    console.log('Merchant Entry Manager initialized');
});
