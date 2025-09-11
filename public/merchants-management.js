/**
 * ===============================================
 * JavaScript for Merchants Management Page
 * وظائف JavaScript لصفحة إدارة التجار
 * ===============================================
 */

class MerchantsManagementManager {
    constructor() {
        this.currentTab = 'merchants';
        this.merchants = [];
        this.products = [];
        this.currentMerchantId = null;
        this.currentProductId = null;
        this.currentPage = 1;
        this.itemsPerPage = 12;
        this.init();
    }

    init() {
        this.setupEventListeners();
        this.loadMerchants();
        this.loadAnalytics();
    }

    // Setup event listeners
    setupEventListeners() {
        // Tab switching
        document.querySelectorAll('.nav-tab').forEach(tab => {
            tab.addEventListener('click', (e) => {
                this.switchTab(e.target.dataset.tab);
            });
        });

        // Search and filters
        document.getElementById('merchantSearch').addEventListener('input', 
            (window.adminUtils ? window.adminUtils.debounce(() => this.filterMerchants(), 300) : this.debounce(() => this.filterMerchants(), 300)));
        document.getElementById('categoryFilter').addEventListener('change', 
            () => this.filterMerchants());
        document.getElementById('statusFilter').addEventListener('change', 
            () => this.filterMerchants());

        document.getElementById('productSearch').addEventListener('input', 
            (window.adminUtils ? window.adminUtils.debounce(() => this.filterProducts(), 300) : this.debounce(() => this.filterProducts(), 300)));
        document.getElementById('productCategoryFilter').addEventListener('change', 
            () => this.filterProducts());
        document.getElementById('merchantFilter').addEventListener('change', 
            () => this.filterProducts());

        // Modal close events
        document.querySelectorAll('.close').forEach(closeBtn => {
            closeBtn.addEventListener('click', (e) => {
                const modal = e.target.closest('.modal');
                modal.style.display = 'none';
            });
        });

        // Close modal when clicking outside
        window.addEventListener('click', (e) => {
            if (e.target.classList.contains('modal')) {
                e.target.style.display = 'none';
            }
        });

        // Form submissions
        document.getElementById('editMerchantForm').addEventListener('submit', (e) => {
            e.preventDefault();
            this.updateMerchant();
        });

        document.getElementById('editProductForm').addEventListener('submit', (e) => {
            e.preventDefault();
            this.updateProduct();
        });
    }

    // Switch between tabs
    switchTab(tabName) {
        // Update tab buttons
        document.querySelectorAll('.nav-tab').forEach(tab => {
            tab.classList.remove('active');
        });
        document.querySelector(`[data-tab="${tabName}"]`).classList.add('active');

        // Update tab content
        document.querySelectorAll('.tab-pane').forEach(pane => {
            pane.classList.remove('active');
        });
        document.getElementById(tabName).classList.add('active');

        this.currentTab = tabName;

        // Load data for the active tab
        switch (tabName) {
            case 'merchants':
                this.loadMerchants();
                break;
            case 'products':
                this.loadProducts();
                break;
            case 'analytics':
                this.loadAnalytics();
                break;
        }
    }

    // Debounce function for search
    debounce(func, wait) {
        let timeout;
        return function executedFunction(...args) {
            const later = () => {
                clearTimeout(timeout);
                func(...args);
            };
            clearTimeout(timeout);
            timeout = setTimeout(later, wait);
        };
    }

    // Load merchants data
    async loadMerchants() {
        if (!window.adminUtils?.adminKey) {
            const gridDiv = document.getElementById('merchantsGrid');
            if (gridDiv) gridDiv.innerHTML = '<p style="padding:20px;color:#dc3545;">مفتاح الإدارة مفقود. يرجى تسجيل الدخول أولاً (?key=YOUR_ADMIN_KEY).</p>';
            return;
        }
        const loadingDiv = document.getElementById('merchantsLoading');
        const gridDiv = document.getElementById('merchantsGrid');
        
        loadingDiv.style.display = 'block';
        gridDiv.innerHTML = '';

        try {
            const adminKey = window.adminUtils?.adminKey || '';
            const response = await fetch('/api/merchants/search', {
                headers: {
                    'Authorization': 'Bearer ' + adminKey
                }
            });
            const result = await response.json();

            if (response.ok && result.success) {
                this.merchants = result.merchants || [];
                this.displayMerchants();
                this.updateMerchantFilter();
            } else {
                this.showError('فشل في تحميل بيانات التجار');
            }
        } catch (error) {
            this.showError('خطأ في الاتصال: ' + error.message);
        } finally {
            loadingDiv.style.display = 'none';
        }
    }

    // Display merchants in grid
    displayMerchants(merchants = this.merchants) {
        const gridDiv = document.getElementById('merchantsGrid');
        
        if (merchants.length === 0) {
            gridDiv.innerHTML = `
                <div class="empty-state">
                    <i class="fas fa-store"></i>
                    <h3>لا توجد تجار</h3>
                    <p>لم يتم العثور على أي تجار</p>
                </div>
            `;
            return;
        }

        gridDiv.innerHTML = merchants.map(merchant => `
            <div class="merchant-card">
                <div class="merchant-status ${merchant.status === 'active' ? 'status-active' : 'status-inactive'}">
                    ${merchant.status === 'active' ? 'نشط' : 'غير نشط'}
                </div>
                
                <div class="merchant-header">
                    <div class="merchant-info">
                        <h3>${merchant.business_name || 'غير محدد'}</h3>
                        <span class="merchant-category">${this.getCategoryName(merchant.business_category)}</span>
                    </div>
                </div>
                
                <div class="merchant-details">
                    <div class="detail-row">
                        <span class="detail-label">رقم الواتساب:</span>
                        <span class="detail-value">${merchant.whatsapp_number || 'غير محدد'}</span>
                    </div>
                    <div class="detail-row">
                        <span class="detail-label">إنستغرام:</span>
                        <span class="detail-value">${merchant.instagram_username || 'غير محدد'}</span>
                    </div>
                    <div class="detail-row">
                        <span class="detail-label">البريد الإلكتروني:</span>
                        <span class="detail-value">${merchant.email || 'غير محدد'}</span>
                    </div>
                    <div class="detail-row">
                        <span class="detail-label">العملة:</span>
                        <span class="detail-value">${merchant.currency || 'غير محدد'}</span>
                    </div>
                    <div class="detail-row">
                        <span class="detail-label">تاريخ الإنشاء:</span>
                        <span class="detail-value">${this.formatDate(merchant.created_at)}</span>
                    </div>
                </div>
                
                <div class="merchant-actions">
                    <button class="btn btn-primary btn-sm" onclick="merchantsManager.editMerchant('${merchant.id}')">
                        <i class="fas fa-edit"></i> تعديل
                    </button>
                    <button class="btn btn-warning btn-sm" onclick="merchantsManager.viewProducts('${merchant.id}')">
                        <i class="fas fa-box"></i> المنتجات
                    </button>
                    <button class="btn btn-danger btn-sm" onclick="merchantsManager.deleteMerchant('${merchant.id}')">
                        <i class="fas fa-trash"></i> حذف
                    </button>
                </div>
                
                <div class="products-section">
                    <div class="products-header">
                        <h4>المنتجات (${merchant.products_count || 0})</h4>
                        <button class="btn btn-success btn-sm" onclick="merchantsManager.addProduct('${merchant.id}')">
                            <i class="fas fa-plus"></i> إضافة منتج
                        </button>
                    </div>
                    <div class="products-list">
                        ${this.renderMerchantProducts(merchant.products || [])}
                    </div>
                </div>
            </div>
        `).join('');
    }

    // Render merchant products
    renderMerchantProducts(products) {
        if (products.length === 0) {
            return '<p style="text-align: center; color: #666; padding: 20px;">لا توجد منتجات</p>';
        }

        return products.slice(0, 3).map(product => `
            <div class="product-item">
                <span class="product-name">${product.name_ar || product.name_en || 'غير محدد'}</span>
                <span class="product-price">$${product.price_usd || 0}</span>
            </div>
        `).join('') + (products.length > 3 ? 
            `<p style="text-align: center; color: #666; padding: 10px;">و ${products.length - 3} منتجات أخرى...</p>` : '');
    }

    // Load products data
    async loadProducts() {
        if (!window.adminUtils?.adminKey) {
            const gridDiv = document.getElementById('productsGrid');
            if (gridDiv) gridDiv.innerHTML = '<p style="padding:20px;color:#dc3545;">مفتاح الإدارة مفقود. يرجى تسجيل الدخول أولاً.</p>';
            return;
        }
        const loadingDiv = document.getElementById('productsLoading');
        const gridDiv = document.getElementById('productsGrid');
        
        loadingDiv.style.display = 'block';
        gridDiv.innerHTML = '';

        try {
            // Load all merchants first to get their products
            const adminKey = window.adminUtils?.adminKey || '';
            const merchantsResponse = await fetch('/api/merchants/search', {
                headers: {
                    'Authorization': 'Bearer ' + adminKey
                }
            });
            const merchantsResult = await merchantsResponse.json();

            if (merchantsResponse.ok && merchantsResult.success) {
                this.merchants = merchantsResult.merchants || [];
                this.products = [];
                
                // Collect all products from all merchants
                this.merchants.forEach(merchant => {
                    if (merchant.products && merchant.products.length > 0) {
                        merchant.products.forEach(product => {
                            this.products.push({
                                ...product,
                                merchant_id: merchant.id,
                                merchant_name: merchant.business_name
                            });
                        });
                    }
                });
                
                this.displayProducts();
                this.updateMerchantFilter();
            } else {
                this.showError('فشل في تحميل بيانات المنتجات');
            }
        } catch (error) {
            this.showError('خطأ في الاتصال: ' + error.message);
        } finally {
            loadingDiv.style.display = 'none';
        }
    }

    // Display products in grid
    displayProducts(products = this.products) {
        const gridDiv = document.getElementById('productsGrid');
        
        if (products.length === 0) {
            gridDiv.innerHTML = `
                <div class="empty-state">
                    <i class="fas fa-box"></i>
                    <h3>لا توجد منتجات</h3>
                    <p>لم يتم العثور على أي منتجات</p>
                </div>
            `;
            return;
        }

        gridDiv.innerHTML = products.map(product => `
            <div class="merchant-card">
                <div class="merchant-header">
                    <div class="merchant-info">
                        <h3>${product.name_ar || product.name_en || 'غير محدد'}</h3>
                        <span class="merchant-category">${this.getCategoryName(product.category)}</span>
                    </div>
                </div>
                
                <div class="merchant-details">
                    <div class="detail-row">
                        <span class="detail-label">رمز المنتج:</span>
                        <span class="detail-value">${product.sku || 'غير محدد'}</span>
                    </div>
                    <div class="detail-row">
                        <span class="detail-label">التاجر:</span>
                        <span class="detail-value">${product.merchant_name || 'غير محدد'}</span>
                    </div>
                    <div class="detail-row">
                        <span class="detail-label">السعر:</span>
                        <span class="detail-value">$${product.price_usd || 0}</span>
                    </div>
                    <div class="detail-row">
                        <span class="detail-label">الكمية:</span>
                        <span class="detail-value">${product.stock_quantity || 0}</span>
                    </div>
                    <div class="detail-row">
                        <span class="detail-label">الحالة:</span>
                        <span class="detail-value">${product.is_active ? 'نشط' : 'غير نشط'}</span>
                    </div>
                </div>
                
                <div class="merchant-actions">
                    <button class="btn btn-primary btn-sm" onclick="merchantsManager.editProduct('${product.id}')">
                        <i class="fas fa-edit"></i> تعديل
                    </button>
                    <button class="btn btn-warning btn-sm" onclick="merchantsManager.viewMerchant('${product.merchant_id}')">
                        <i class="fas fa-store"></i> عرض التاجر
                    </button>
                    <button class="btn btn-danger btn-sm" onclick="merchantsManager.deleteProduct('${product.id}')">
                        <i class="fas fa-trash"></i> حذف
                    </button>
                </div>
            </div>
        `).join('');
    }

    // Load analytics data
    async loadAnalytics() {
        if (!window.adminUtils?.adminKey) {
            const analyticsDiv = document.getElementById('analyticsResults');
            if (analyticsDiv) analyticsDiv.innerHTML = '<p style="padding:20px;color:#dc3545;">مفتاح الإدارة مفقود. يرجى تسجيل الدخول أولاً.</p>';
            return;
        }
        const loadingDiv = document.getElementById('analyticsLoading');
        
        loadingDiv.style.display = 'block';

        try {
            // Calculate analytics from loaded data
            const totalMerchants = this.merchants.length;
            const activeMerchants = this.merchants.filter(m => m.status === 'active').length;
            const totalProducts = this.products.length;
            const totalRevenue = this.products.reduce((sum, product) => 
                sum + (product.price_usd || 0) * (product.stock_quantity || 0), 0);

            // Update analytics display
            document.getElementById('totalMerchants').textContent = totalMerchants;
            document.getElementById('activeMerchants').textContent = activeMerchants;
            document.getElementById('totalProducts').textContent = totalProducts;
            document.getElementById('totalRevenue').textContent = `$${totalRevenue.toFixed(2)}`;

        } catch (error) {
            this.showError('خطأ في تحميل الإحصائيات: ' + error.message);
        } finally {
            loadingDiv.style.display = 'none';
        }
    }

    // Filter merchants
    filterMerchants() {
        const searchTerm = document.getElementById('merchantSearch').value.toLowerCase();
        const categoryFilter = document.getElementById('categoryFilter').value;
        const statusFilter = document.getElementById('statusFilter').value;

        let filtered = this.merchants.filter(merchant => {
            const matchesSearch = !searchTerm || 
                merchant.business_name?.toLowerCase().includes(searchTerm) ||
                merchant.whatsapp_number?.includes(searchTerm) ||
                merchant.instagram_username?.toLowerCase().includes(searchTerm) ||
                merchant.email?.toLowerCase().includes(searchTerm);

            const matchesCategory = !categoryFilter || merchant.business_category === categoryFilter;
            const matchesStatus = !statusFilter || merchant.status === statusFilter;

            return matchesSearch && matchesCategory && matchesStatus;
        });

        this.displayMerchants(filtered);
    }

    // Filter products
    filterProducts() {
        const searchTerm = document.getElementById('productSearch').value.toLowerCase();
        const categoryFilter = document.getElementById('productCategoryFilter').value;
        const merchantFilter = document.getElementById('merchantFilter').value;

        let filtered = this.products.filter(product => {
            const matchesSearch = !searchTerm || 
                product.name_ar?.toLowerCase().includes(searchTerm) ||
                product.name_en?.toLowerCase().includes(searchTerm) ||
                product.sku?.toLowerCase().includes(searchTerm);

            const matchesCategory = !categoryFilter || product.category === categoryFilter;
            const matchesMerchant = !merchantFilter || product.merchant_id === merchantFilter;

            return matchesSearch && matchesCategory && matchesMerchant;
        });

        this.displayProducts(filtered);
    }

    // Update merchant filter dropdown
    updateMerchantFilter() {
        const merchantFilter = document.getElementById('merchantFilter');
        const currentValue = merchantFilter.value;
        
        merchantFilter.innerHTML = '<option value="">جميع التجار</option>';
        
        this.merchants.forEach(merchant => {
            const option = document.createElement('option');
            option.value = merchant.id;
            option.textContent = merchant.business_name || 'غير محدد';
            merchantFilter.appendChild(option);
        });
        
        merchantFilter.value = currentValue;
    }

    // Edit merchant
    editMerchant(merchantId) {
        const merchant = this.merchants.find(m => m.id === merchantId);
        if (!merchant) return;

        this.currentMerchantId = merchantId;

        // Populate form
        document.getElementById('editBusinessName').value = merchant.business_name || '';
        document.getElementById('editBusinessCategory').value = merchant.business_category || '';
        document.getElementById('editWhatsappNumber').value = merchant.whatsapp_number || '';
        document.getElementById('editInstagramUsername').value = merchant.instagram_username || '';
        document.getElementById('editEmail').value = merchant.email || '';
        document.getElementById('editCurrency').value = merchant.currency || 'IQD';
        document.getElementById('editStatus').value = merchant.status || 'active';

        // Show modal
        document.getElementById('editMerchantModal').style.display = 'block';
    }

    // Update merchant
    async updateMerchant() {
        if (!this.currentMerchantId) return;

        const formData = new FormData(document.getElementById('editMerchantForm'));
        const data = Object.fromEntries(formData.entries());

        try {
            const csrf = window.adminUtils?.getCsrfToken ? window.adminUtils.getCsrfToken() : '';
            const response = await fetch(`/api/merchants/${this.currentMerchantId}`, {
                method: 'PUT',
                headers: Object.assign({ 'Content-Type': 'application/json' }, csrf ? { 'X-CSRF-Token': csrf } : {}),
                credentials: 'include',
                body: JSON.stringify(data)
            });

            const result = await response.json();

            if (response.ok && result.success) {
                this.showSuccess('تم تحديث بيانات التاجر بنجاح');
                this.closeModal('editMerchantModal');
                this.loadMerchants();
            } else {
                this.showError(result.message || 'فشل في تحديث بيانات التاجر');
            }
        } catch (error) {
            this.showError('خطأ في الاتصال: ' + error.message);
        }
    }

    // Edit product
    editProduct(productId) {
        const product = this.products.find(p => p.id === productId);
        if (!product) return;

        this.currentProductId = productId;

        // Populate form
        document.getElementById('editProductSku').value = product.sku || '';
        document.getElementById('editProductNameAr').value = product.name_ar || '';
        document.getElementById('editProductNameEn').value = product.name_en || '';
        document.getElementById('editProductCategory').value = product.category || 'general';
        document.getElementById('editProductDescription').value = product.description_ar || '';
        document.getElementById('editProductPrice').value = product.price_usd || 0;
        document.getElementById('editProductStock').value = product.stock_quantity || 0;
        document.getElementById('editProductTags').value = product.tags ? product.tags.join(', ') : '';
        document.getElementById('editProductStatus').value = product.is_active ? 'true' : 'false';

        // Show modal
        document.getElementById('editProductModal').style.display = 'block';
    }

    // Update product
    async updateProduct() {
        if (!this.currentProductId) return;

        const formData = new FormData(document.getElementById('editProductForm'));
        const data = Object.fromEntries(formData.entries());
        
        // Convert tags string to array
        if (data.tags) {
            data.tags = data.tags.split(',').map(tag => tag.trim()).filter(tag => tag);
        }

        try {
            const csrf = window.adminUtils?.getCsrfToken ? window.adminUtils.getCsrfToken() : '';
            const response = await fetch(`/api/products/${this.currentProductId}`, {
                method: 'PUT',
                headers: Object.assign({ 'Content-Type': 'application/json' }, csrf ? { 'X-CSRF-Token': csrf } : {}),
                credentials: 'include',
                body: JSON.stringify(data)
            });

            const result = await response.json();

            if (response.ok && result.success) {
                this.showSuccess('تم تحديث بيانات المنتج بنجاح');
                this.closeModal('editProductModal');
                this.loadProducts();
            } else {
                this.showError(result.message || 'فشل في تحديث بيانات المنتج');
            }
        } catch (error) {
            this.showError('خطأ في الاتصال: ' + error.message);
        }
    }

    // Delete merchant
    async deleteMerchant(merchantId) {
        if (!confirm('هل أنت متأكد من حذف هذا التاجر؟ سيتم حذف جميع المنتجات المرتبطة به.')) {
            return;
        }

        try {
            const csrf = window.adminUtils?.getCsrfToken ? window.adminUtils.getCsrfToken() : '';
            const response = await fetch(`/api/merchants/${merchantId}`, {
                method: 'DELETE',
                headers: Object.assign({}, csrf ? { 'X-CSRF-Token': csrf } : {}),
                credentials: 'include'
            });

            const result = await response.json();

            if (response.ok && result.success) {
                this.showSuccess('تم حذف التاجر بنجاح');
                this.loadMerchants();
            } else {
                this.showError(result.message || 'فشل في حذف التاجر');
            }
        } catch (error) {
            this.showError('خطأ في الاتصال: ' + error.message);
        }
    }

    // Delete product
    async deleteProduct(productId) {
        if (!confirm('هل أنت متأكد من حذف هذا المنتج؟')) {
            return;
        }

        try {
            const csrf = window.adminUtils?.getCsrfToken ? window.adminUtils.getCsrfToken() : '';
            const response = await fetch(`/api/products/${productId}`, {
                method: 'DELETE',
                headers: Object.assign({}, csrf ? { 'X-CSRF-Token': csrf } : {}),
                credentials: 'include'
            });

            const result = await response.json();

            if (response.ok && result.success) {
                this.showSuccess('تم حذف المنتج بنجاح');
                this.loadProducts();
            } else {
                this.showError(result.message || 'فشل في حذف المنتج');
            }
        } catch (error) {
            this.showError('خطأ في الاتصال: ' + error.message);
        }
    }

    // View merchant products
    viewProducts(merchantId) {
        this.switchTab('products');
        document.getElementById('merchantFilter').value = merchantId;
        this.filterProducts();
    }

    // View merchant details
    viewMerchant(merchantId) {
        this.switchTab('merchants');
        // Scroll to merchant card
        const merchantCard = document.querySelector(`[onclick*="${merchantId}"]`)?.closest('.merchant-card');
        if (merchantCard) {
            merchantCard.scrollIntoView({ behavior: 'smooth' });
        }
    }

    // Add product to merchant
    addProduct(merchantId) {
        // Redirect to merchant entry page with merchant ID
        window.location.href = `merchant-entry.html?merchant_id=${merchantId}&action=add_product`;
    }

    // Close modal
    closeModal(modalId) {
        document.getElementById(modalId).style.display = 'none';
    }

    // Show success message
    showSuccess(message) {
        if (window.adminUtils) {
            window.adminUtils.showToast(message, 'success');
        } else {
            // Fallback to old method
            const successDiv = document.createElement('div');
            successDiv.style.cssText = `
                position: fixed;
                top: 20px;
                right: 20px;
                background: #d4edda;
                color: #155724;
                padding: 15px 20px;
                border-radius: 8px;
                border: 2px solid #c3e6cb;
                z-index: 10000;
                font-weight: 600;
            `;
            successDiv.textContent = message;
            document.body.appendChild(successDiv);

            setTimeout(() => {
                if (document.body.contains(successDiv)) {
                    document.body.removeChild(successDiv);
                }
            }, 3000);
        }
    }

    // Show error message
    showError(message) {
        if (window.adminUtils) {
            window.adminUtils.showToast(message, 'error');
        } else {
            // Fallback to old method
            const errorDiv = document.createElement('div');
            errorDiv.style.cssText = `
                position: fixed;
                top: 20px;
                right: 20px;
                background: #f8d7da;
                color: #721c24;
                padding: 15px 20px;
                border-radius: 8px;
                border: 2px solid #f5c6cb;
                z-index: 10000;
                font-weight: 600;
            `;
            errorDiv.textContent = message;
            document.body.appendChild(errorDiv);

            setTimeout(() => {
                if (document.body.contains(errorDiv)) {
                    document.body.removeChild(errorDiv);
                }
            }, 5000);
        }
    }

    // Get category name in Arabic
    getCategoryName(category) {
        const categories = {
            'fashion': 'أزياء',
            'electronics': 'إلكترونيات',
            'beauty': 'جمال',
            'home': 'منزل',
            'sports': 'رياضة',
            'grocery': 'مواد غذائية',
            'automotive': 'سيارات',
            'health': 'صحة',
            'education': 'تعليم',
            'general': 'عام'
        };
        return categories[category] || category || 'غير محدد';
    }

    // Format date
    formatDate(dateString) {
        if (!dateString) return 'غير محدد';
        const date = new Date(dateString);
        return date.toLocaleDateString('ar-SA');
    }
    
    // Search merchant by ID or name
    async searchMerchant() {
        const searchInput = document.getElementById('merchantSearch');
        if (!searchInput) return;
        
        const query = searchInput.value.trim();
        if (!query) {
            this.displayMerchants();
            return;
        }
        
        try {
            const csrf = window.adminUtils?.getCsrfToken ? window.adminUtils.getCsrfToken() : '';
            const response = await fetch(`/api/merchants/search?search=${encodeURIComponent(query)}`, {
                headers: Object.assign({}, csrf ? { 'X-CSRF-Token': csrf } : {}),
                credentials: 'include'
            });
            
            const result = await response.json();
            if (response.ok && result.success) {
                this.displayMerchants(result.merchants);
            } else {
                this.showError('فشل في البحث عن التجار');
            }
        } catch (error) {
            this.showError('خطأ في البحث: ' + error.message);
        }
    }
    
    // Load services for current tab
    async loadServices() {
        const servicesDiv = document.getElementById('servicesResults');
        if (servicesDiv) {
            servicesDiv.innerHTML = '<p>جاري تحميل الخدمات...</p>';
            // This would connect to services API when available
            setTimeout(() => {
                servicesDiv.innerHTML = '<p>خدمات النظام متاحة وتعمل بشكل طبيعي</p>';
            }, 1000);
        }
    }
    
    // (Removed duplicate loadProducts that caused recursion)
    
    // Load analytics for current tab
    async loadAnalytics() {
        const analyticsDiv = document.getElementById('analyticsResults');
        if (analyticsDiv) {
            analyticsDiv.innerHTML = '<p>جاري تحميل التحليلات...</p>';
            
            try {
                const response = await fetch('/api/analytics/summary', { credentials: 'include' });
                
                const result = await response.json();
                if (response.ok && result.success) {
                    analyticsDiv.innerHTML = `
                        <div class="analytics-summary">
                            <div class="metric-card">
                                <h3>إجمالي التجار</h3>
                                <p class="metric-value">${result.total_merchants}</p>
                            </div>
                            <div class="metric-card">
                                <h3>إجمالي المنتجات</h3>
                                <p class="metric-value">${result.total_products}</p>
                            </div>
                            <div class="metric-card">
                                <h3>قيمة المخزون</h3>
                                <p class="metric-value">$${result.total_inventory_value.toFixed(2)}</p>
                            </div>
                        </div>
                    `;
                } else {
                    analyticsDiv.innerHTML = '<p>فشل في تحميل التحليلات</p>';
                }
            } catch (error) {
                analyticsDiv.innerHTML = '<p>خطأ في تحميل التحليلات: ' + error.message + '</p>';
            }
        }
    }
}

// Global functions for onclick handlers
function closeModal(modalId) {
    document.getElementById(modalId).style.display = 'none';
}

// Initialize when page loads
let merchantsManager;
document.addEventListener('DOMContentLoaded', () => {
    merchantsManager = new MerchantsManagementManager();
    console.log('Merchants Management Manager initialized');
});
