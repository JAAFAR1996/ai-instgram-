/**
 * Admin Utilities - Helper functions for admin interfaces
 */

class AdminUtils {
    constructor() {
        this.adminKey = new URLSearchParams(window.location.search).get('key') || 'jaafar_admin_2025';
    }

    // Show toast notification
    showToast(message, type = 'success', duration = 3000) {
        const toast = document.createElement('div');
        toast.className = `toast ${type}`;
        toast.textContent = message;
        
        document.body.appendChild(toast);
        
        setTimeout(() => {
            toast.style.animation = 'slideOut 0.3s ease';
            setTimeout(() => {
                if (document.body.contains(toast)) {
                    document.body.removeChild(toast);
                }
            }, 300);
        }, duration);
    }

    // Show loading state on button
    setButtonLoading(button, loading = true) {
        if (loading) {
            button.classList.add('btn-loading');
            button.disabled = true;
            button.dataset.originalText = button.textContent;
            button.textContent = 'جاري المعالجة...';
        } else {
            button.classList.remove('btn-loading');
            button.disabled = false;
            if (button.dataset.originalText) {
                button.textContent = button.dataset.originalText;
                delete button.dataset.originalText;
            }
        }
    }

    // Validate form field
    validateField(field, rules = {}) {
        const value = field.value.trim();
        let isValid = true;
        let errorMessage = '';

        // Remove previous validation classes
        field.classList.remove('form-validation-error', 'form-validation-success');
        const existingError = field.parentElement.querySelector('.field-error');
        if (existingError) {
            existingError.remove();
        }

        // Required validation
        if (rules.required && !value) {
            isValid = false;
            errorMessage = 'هذا الحقل مطلوب';
        }

        // Email validation
        if (rules.email && value && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
            isValid = false;
            errorMessage = 'البريد الإلكتروني غير صحيح';
        }

        // Phone validation
        if (rules.phone && value && !/^[\+]?[1-9][\d]{0,15}$/.test(value.replace(/\s/g, ''))) {
            isValid = false;
            errorMessage = 'رقم الهاتف غير صحيح';
        }

        // Min length validation
        if (rules.minLength && value && value.length < rules.minLength) {
            isValid = false;
            errorMessage = `يجب أن يكون على الأقل ${rules.minLength} أحرف`;
        }

        // Max length validation
        if (rules.maxLength && value && value.length > rules.maxLength) {
            isValid = false;
            errorMessage = `يجب أن يكون أقل من ${rules.maxLength} حرف`;
        }

        // Apply validation styling
        if (isValid) {
            field.classList.add('form-validation-success');
        } else {
            field.classList.add('form-validation-error');
            const errorSpan = document.createElement('span');
            errorSpan.className = 'field-error';
            errorSpan.textContent = errorMessage;
            field.parentElement.appendChild(errorSpan);
        }

        return { isValid, errorMessage };
    }

    // Format currency
    formatCurrency(amount, currency = 'USD') {
        const formatter = new Intl.NumberFormat('ar-IQ', {
            style: 'currency',
            currency: currency,
            minimumFractionDigits: 2
        });
        return formatter.format(amount);
    }

    // Format date
    formatDate(dateString, options = {}) {
        if (!dateString) return 'غير محدد';
        
        const defaultOptions = {
            year: 'numeric',
            month: 'long',
            day: 'numeric',
            ...options
        };
        
        const date = new Date(dateString);
        return date.toLocaleDateString('ar-SA', defaultOptions);
    }

    // Debounce function
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

    // Confirm dialog
    async confirm(message, title = 'تأكيد') {
        return new Promise((resolve) => {
            const confirmed = window.confirm(`${title}\n\n${message}`);
            resolve(confirmed);
        });
    }

    // Upload file with progress
    async uploadFile(file, endpoint = '/admin/upload', onProgress = null) {
        return new Promise((resolve, reject) => {
            const formData = new FormData();
            formData.append('file', file);

            const xhr = new XMLHttpRequest();

            // Track upload progress
            if (onProgress) {
                xhr.upload.addEventListener('progress', (e) => {
                    if (e.lengthComputable) {
                        const percentComplete = (e.loaded / e.total) * 100;
                        onProgress(percentComplete);
                    }
                });
            }

            xhr.addEventListener('load', () => {
                if (xhr.status === 200) {
                    try {
                        const response = JSON.parse(xhr.responseText);
                        resolve(response);
                    } catch (error) {
                        reject(new Error('Invalid response format'));
                    }
                } else {
                    reject(new Error(`Upload failed with status ${xhr.status}`));
                }
            });

            xhr.addEventListener('error', () => {
                reject(new Error('Upload failed'));
            });

            xhr.open('POST', endpoint);
            xhr.setRequestHeader('Authorization', `Bearer ${this.adminKey}`);
            xhr.send(formData);
        });
    }

    // API request helper
    async apiRequest(url, options = {}) {
        const defaultOptions = {
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${this.adminKey}`,
                ...options.headers
            },
            ...options
        };

        try {
            const response = await fetch(url, defaultOptions);
            const data = await response.json();

            if (!response.ok) {
                throw new Error(data.error || `HTTP ${response.status}`);
            }

            return data;
        } catch (error) {
            console.error('API Request failed:', error);
            throw error;
        }
    }

    // Highlight search terms
    highlightSearchTerms(text, searchTerm) {
        if (!searchTerm || !text) return text;
        
        const regex = new RegExp(`(${searchTerm})`, 'gi');
        return text.replace(regex, '<span class="search-highlight">$1</span>');
    }

    // Generate pagination
    generatePagination(currentPage, totalPages, onPageChange) {
        const pagination = document.createElement('div');
        pagination.className = 'pagination';

        // Previous button
        const prevBtn = document.createElement('button');
        prevBtn.textContent = 'السابق';
        prevBtn.disabled = currentPage <= 1;
        prevBtn.addEventListener('click', () => {
            if (currentPage > 1) onPageChange(currentPage - 1);
        });
        pagination.appendChild(prevBtn);

        // Page numbers
        const startPage = Math.max(1, currentPage - 2);
        const endPage = Math.min(totalPages, currentPage + 2);

        for (let i = startPage; i <= endPage; i++) {
            const pageBtn = document.createElement('button');
            pageBtn.textContent = i;
            pageBtn.className = i === currentPage ? 'active' : '';
            pageBtn.addEventListener('click', () => onPageChange(i));
            pagination.appendChild(pageBtn);
        }

        // Next button
        const nextBtn = document.createElement('button');
        nextBtn.textContent = 'التالي';
        nextBtn.disabled = currentPage >= totalPages;
        nextBtn.addEventListener('click', () => {
            if (currentPage < totalPages) onPageChange(currentPage + 1);
        });
        pagination.appendChild(nextBtn);

        return pagination;
    }

    // Create status badge
    createStatusBadge(status) {
        const badge = document.createElement('span');
        badge.className = `status-badge status-${status.toLowerCase()}`;
        
        const statusText = {
            'active': 'نشط',
            'inactive': 'غير نشط',
            'pending': 'في الانتظار',
            'suspended': 'معلق'
        };
        
        badge.textContent = statusText[status.toLowerCase()] || status;
        return badge;
    }

    // Format file size
    formatFileSize(bytes) {
        if (bytes === 0) return '0 Bytes';
        
        const k = 1024;
        const sizes = ['Bytes', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    }

    // Copy to clipboard
    async copyToClipboard(text) {
        try {
            await navigator.clipboard.writeText(text);
            this.showToast('تم النسخ إلى الحافظة', 'success');
            return true;
        } catch (error) {
            console.error('Failed to copy to clipboard:', error);
            this.showToast('فشل في النسخ', 'error');
            return false;
        }
    }

    // Export data as CSV
    exportToCSV(data, filename = 'export.csv') {
        if (!data || data.length === 0) {
            this.showToast('لا توجد بيانات للتصدير', 'warning');
            return;
        }

        const headers = Object.keys(data[0]);
        const csvContent = [
            headers.join(','),
            ...data.map(row => 
                headers.map(header => 
                    JSON.stringify(row[header] || '')
                ).join(',')
            )
        ].join('\n');

        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        const link = document.createElement('a');
        
        if (link.download !== undefined) {
            const url = URL.createObjectURL(blob);
            link.setAttribute('href', url);
            link.setAttribute('download', filename);
            link.style.visibility = 'hidden';
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            
            this.showToast('تم تصدير البيانات بنجاح', 'success');
        }
    }

    // Initialize tooltips
    initializeTooltips() {
        const tooltipElements = document.querySelectorAll('[data-tooltip]');
        
        tooltipElements.forEach(element => {
            element.addEventListener('mouseenter', (e) => {
                const tooltip = document.createElement('div');
                tooltip.className = 'tooltip';
                tooltip.textContent = e.target.dataset.tooltip;
                tooltip.style.cssText = `
                    position: absolute;
                    background: rgba(0,0,0,0.8);
                    color: white;
                    padding: 8px 12px;
                    border-radius: 4px;
                    font-size: 12px;
                    z-index: 10000;
                    pointer-events: none;
                    white-space: nowrap;
                `;
                
                document.body.appendChild(tooltip);
                
                const rect = e.target.getBoundingClientRect();
                tooltip.style.left = rect.left + (rect.width / 2) - (tooltip.offsetWidth / 2) + 'px';
                tooltip.style.top = rect.top - tooltip.offsetHeight - 8 + 'px';
                
                e.target.tooltipElement = tooltip;
            });
            
            element.addEventListener('mouseleave', (e) => {
                if (e.target.tooltipElement) {
                    document.body.removeChild(e.target.tooltipElement);
                    delete e.target.tooltipElement;
                }
            });
        });
    }
}

// Global instance
window.adminUtils = new AdminUtils();

// Initialize on DOM ready
document.addEventListener('DOMContentLoaded', () => {
    window.adminUtils.initializeTooltips();
});

// Add CSS for animations
const style = document.createElement('style');
style.textContent = `
    @keyframes slideOut {
        from {
            transform: translateX(0);
            opacity: 1;
        }
        to {
            transform: translateX(100%);
            opacity: 0;
        }
    }
    
    .tooltip {
        animation: fadeIn 0.2s ease;
    }
    
    @keyframes fadeIn {
        from { opacity: 0; }
        to { opacity: 1; }
    }
`;
document.head.appendChild(style);