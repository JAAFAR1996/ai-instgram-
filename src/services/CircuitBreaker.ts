export type CircuitBreakerState = 'CLOSED' | 'OPEN' | 'HALF_OPEN';

export interface CircuitBreakerOptions {
  failureThreshold: number;        // عدد الأخطاء المسموح قبل فتح الدائرة
  recoveryTimeout: number;         // وقت الانتظار قبل المحاولة مرة أخرى (بالميلي ثانية)
  monitoringPeriod: number;        // فترة مراقبة النجاح/الفشل (بالميلي ثانية)
  expectedErrorThreshold: number;  // نسبة الخطأ المتوقعة (%)
  halfOpenMaxCalls: number;        // عدد المحاولات في حالة نصف مفتوح
  timeout: number;                 // مهلة زمنية للعمليات
}

export interface CircuitBreakerResult<T> {
  success: boolean;
  result?: T;
  error?: string;
  fallbackUsed: boolean;
  state: CircuitBreakerState;
  executionTime: number;
  circuitOpenSince?: Date;
}

export interface CircuitBreakerStats {
  state: CircuitBreakerState;
  failureCount: number;
  successCount: number;
  lastFailureTime?: Date;
  lastSuccessTime?: Date;
  totalExecutions: number;
  averageExecutionTime: number;
  errorRate: number;
  uptimePercentage: number;
  circuitOpenCount: number;
  lastStateChange: Date;
}

export class CircuitBreaker {
  private state: CircuitBreakerState = 'CLOSED';
  private failureCount = 0;
  private successCount = 0;
  private lastFailureTime = 0;
  private lastSuccessTime = 0;
  private lastStateChange = new Date();
  private circuitOpenCount = 0;
  private totalExecutions = 0;
  private totalExecutionTime = 0;
  private halfOpenCallCount = 0;
  
  private readonly options: CircuitBreakerOptions;

  constructor(
    failureThreshold: number = 5,
    recoveryTimeout: number = 60000,
    options: Partial<CircuitBreakerOptions> = {}
  ) {
    this.options = {
      failureThreshold,
      recoveryTimeout,
      monitoringPeriod: options.monitoringPeriod || 300000,    // 5 دقائق
      expectedErrorThreshold: options.expectedErrorThreshold || 50,  // 50%
      halfOpenMaxCalls: options.halfOpenMaxCalls || 3,
      timeout: options.timeout || 10000,  // 10 ثواني
      ...options
    };
  }

  async execute<T>(
    operation: () => Promise<T>,
    fallback?: () => Promise<T>
  ): Promise<CircuitBreakerResult<T>> {
    const startTime = Date.now();
    this.totalExecutions++;

    // فحص حالة الدائرة
    this.updateStateIfNeeded();

    if (this.state === 'OPEN') {
      return await this.handleOpenCircuit(fallback, startTime);
    }

    if (this.state === 'HALF_OPEN') {
      if (this.halfOpenCallCount >= this.options.halfOpenMaxCalls) {
        return await this.handleOpenCircuit(fallback, startTime);
      }
      this.halfOpenCallCount++;
    }

    // تنفيذ العملية مع مهلة زمنية
    try {
      const result = await this.executeWithTimeout(operation);
      const executionTime = Date.now() - startTime;
      
      await this.onSuccess(executionTime);
      
      return {
        success: true,
        result,
        fallbackUsed: false,
        state: this.state,
        executionTime
      };

    } catch (error) {
      const executionTime = Date.now() - startTime;
      await this.onFailure();
      
      // في حالة الفشل، استخدام البديل إن وُجد
      if (fallback) {
        try {
          const fallbackResult = await fallback();
          return {
            success: true,
            result: fallbackResult,
            fallbackUsed: true,
            state: this.state,
            executionTime,
            error: error instanceof Error ? error.message : String(error)
          };
        } catch (fallbackError) {
          return {
            success: false,
            fallbackUsed: true,
            state: this.state,
            executionTime,
            error: fallbackError instanceof Error ? fallbackError.message : String(fallbackError)
          };
        }
      }

      return {
        success: false,
        fallbackUsed: false,
        state: this.state,
        executionTime,
        error: error instanceof Error ? error.message : String(error)
      };
    }
  }

  private async executeWithTimeout<T>(operation: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        reject(new Error(`العملية تجاوزت المهلة الزمنية المحددة: ${this.options.timeout}ms`));
      }, this.options.timeout);

      operation()
        .then(result => {
          clearTimeout(timeoutId);
          resolve(result);
        })
        .catch(error => {
          clearTimeout(timeoutId);
          reject(error);
        });
    });
  }

  private async handleOpenCircuit<T>(
    fallback?: () => Promise<T>,
    startTime: number = Date.now()
  ): Promise<CircuitBreakerResult<T>> {
    const executionTime = Date.now() - startTime;

    if (fallback) {
      try {
        const result = await fallback();
        return {
          success: true,
          result,
          fallbackUsed: true,
          state: this.state,
          executionTime,
          circuitOpenSince: new Date(this.lastStateChange)
        };
      } catch (error) {
        return {
          success: false,
          fallbackUsed: true,
          state: this.state,
          executionTime,
          error: error instanceof Error ? error.message : String(error),
          circuitOpenSince: new Date(this.lastStateChange)
        };
      }
    }

    return {
      success: false,
      fallbackUsed: false,
      state: this.state,
      executionTime,
      error: 'الدائرة مفتوحة - العملية مرفوضة',
      circuitOpenSince: new Date(this.lastStateChange)
    };
  }

  private async onSuccess(executionTime: number): Promise<void> {
    this.successCount++;
    this.lastSuccessTime = Date.now();
    this.totalExecutionTime += executionTime;

    if (this.state === 'HALF_OPEN') {
      // في حالة نصف مفتوح، العودة إلى مغلق بعد نجاح
      this.closeCircuit();
    } else if (this.state === 'CLOSED') {
      // إعادة تعيين عداد الفشل في حالة النجاح
      this.failureCount = Math.max(0, this.failureCount - 1);
    }
  }

  private async onFailure(): Promise<void> {
    this.failureCount++;
    this.lastFailureTime = Date.now();

    if (this.state === 'CLOSED' && this.failureCount >= this.options.failureThreshold) {
      this.openCircuit();
    } else if (this.state === 'HALF_OPEN') {
      // فشل في حالة نصف مفتوح يعيد فتح الدائرة
      this.openCircuit();
    }
  }

  private updateStateIfNeeded(): void {
    if (this.state === 'OPEN') {
      const timeSinceLastFailure = Date.now() - this.lastFailureTime;
      if (timeSinceLastFailure >= this.options.recoveryTimeout) {
        this.halfOpenCircuit();
      }
    }
  }

  private closeCircuit(): void {
    if (this.state !== 'CLOSED') {
      this.state = 'CLOSED';
      this.failureCount = 0;
      this.halfOpenCallCount = 0;
      this.lastStateChange = new Date();
    }
  }

  private openCircuit(): void {
    if (this.state !== 'OPEN') {
      this.state = 'OPEN';
      this.circuitOpenCount++;
      this.halfOpenCallCount = 0;
      this.lastStateChange = new Date();
    }
  }

  private halfOpenCircuit(): void {
    this.state = 'HALF_OPEN';
    this.halfOpenCallCount = 0;
    this.lastStateChange = new Date();
  }

  getStats(): CircuitBreakerStats {
    const now = Date.now();
    const monitoringWindow = this.options.monitoringPeriod;
    
    // حساب معدل الخطأ في فترة المراقبة
    const recentFailures = this.lastFailureTime > (now - monitoringWindow) ? this.failureCount : 0;
    const recentTotal = this.totalExecutions;
    const errorRate = recentTotal > 0 ? (recentFailures / recentTotal) * 100 : 0;
    
    // حساب نسبة التشغيل
    const totalTime = now - this.lastStateChange.getTime();
    const downTime = this.state === 'OPEN' ? (now - this.lastStateChange.getTime()) : 0;
    const uptimePercentage = totalTime > 0 ? ((totalTime - downTime) / totalTime) * 100 : 100;
    
    // حساب متوسط وقت التنفيذ
    const averageExecutionTime = this.totalExecutions > 0 
      ? this.totalExecutionTime / this.totalExecutions 
      : 0;

    return {
      state: this.state,
      failureCount: this.failureCount,
      successCount: this.successCount,
      lastFailureTime: this.lastFailureTime > 0 ? new Date(this.lastFailureTime) : undefined,
      lastSuccessTime: this.lastSuccessTime > 0 ? new Date(this.lastSuccessTime) : undefined,
      totalExecutions: this.totalExecutions,
      averageExecutionTime: Math.round(averageExecutionTime),
      errorRate: Math.round(errorRate * 100) / 100,
      uptimePercentage: Math.round(uptimePercentage * 100) / 100,
      circuitOpenCount: this.circuitOpenCount,
      lastStateChange: this.lastStateChange
    };
  }

  // إعادة تعيين الدائرة يدوياً
  reset(): void {
    this.state = 'CLOSED';
    this.failureCount = 0;
    this.successCount = 0;
    this.halfOpenCallCount = 0;
    this.lastFailureTime = 0;
    this.lastSuccessTime = 0;
    this.lastStateChange = new Date();
  }

  // فرض فتح الدائرة (للاختبار أو الصيانة)
  forceOpen(): void {
    this.openCircuit();
  }

  // فرض إغلاق الدائرة (للاختبار أو الصيانة)
  forceClose(): void {
    this.closeCircuit();
  }

  // التحقق من حالة الدائرة
  isOpen(): boolean {
    this.updateStateIfNeeded();
    return this.state === 'OPEN';
  }

  isClosed(): boolean {
    this.updateStateIfNeeded();
    return this.state === 'CLOSED';
  }

  isHalfOpen(): boolean {
    this.updateStateIfNeeded();
    return this.state === 'HALF_OPEN';
  }

  // الحصول على معلومات التشخيص
  getDiagnostics(): {
    healthy: boolean;
    issues: string[];
    recommendations: string[];
  } {
    const stats = this.getStats();
    const issues: string[] = [];
    const recommendations: string[] = [];
    
    if (stats.state === 'OPEN') {
      issues.push('الدائرة مفتوحة - الخدمة غير متاحة');
      recommendations.push('فحص الخدمة الأساسية وإصلاح المشاكل');
    }
    
    if (stats.errorRate > this.options.expectedErrorThreshold) {
      issues.push(`معدل الخطأ عالي: ${stats.errorRate}%`);
      recommendations.push('مراجعة سجلات الأخطاء وتحسين استقرار الخدمة');
    }
    
    if (stats.averageExecutionTime > this.options.timeout * 0.8) {
      issues.push(`متوسط وقت التنفيذ مرتفع: ${stats.averageExecutionTime}ms`);
      recommendations.push('تحسين أداء العمليات أو زيادة المهلة الزمنية');
    }
    
    if (stats.uptimePercentage < 95) {
      issues.push(`نسبة التشغيل منخفضة: ${stats.uptimePercentage}%`);
      recommendations.push('تحسين موثوقية الخدمة');
    }

    return {
      healthy: issues.length === 0,
      issues,
      recommendations
    };
  }
}

export default CircuitBreaker;