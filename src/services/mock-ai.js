/**
 * Mock AI Service for Testing
 */

export class MockOpenAI {
  chat = {
    completions: {
      async create(params) {
        console.log('🤖 Mock AI Request:', params.messages[params.messages.length - 1].content);
        
        // Return mock AI response based on input
        const userMessage = params.messages[params.messages.length - 1].content;
        
        let mockResponse = 'مرحبا! كيف يمكنني مساعدتك اليوم؟';
        
        if (userMessage.includes('منتجات')) {
          mockResponse = 'لدينا منتجات رائعة جديدة! يمكنك تصفح مجموعتنا الكاملة. هل تبحث عن شيء محدد؟';
        } else if (userMessage.includes('سعر')) {
          mockResponse = 'راسلنا خاص للاستفسار عن الأسعار والتفاصيل. سنكون سعداء لمساعدتك! 💬';
        } else if (userMessage.includes('شكرا')) {
          mockResponse = 'عفوا! نحن هنا لخدمتك دائما 😊';
        }

        return {
          choices: [{
            message: {
              content: JSON.stringify({
                message: mockResponse,
                intent: 'PRODUCT_INQUIRY',
                confidence: 0.85,
                actions: [
                  { type: 'REPLY', content: mockResponse }
                ],
                products: [],
                hashtagSuggestions: ['#العراق', '#بغداد', '#تسوق'],
                responseTime: Date.now(),
                visualStyle: 'dm'
              })
            }
          }],
          usage: {
            prompt_tokens: 50,
            completion_tokens: 30,
            total_tokens: 80
          }
        };
      }
    }
  };
}

export default MockOpenAI;
