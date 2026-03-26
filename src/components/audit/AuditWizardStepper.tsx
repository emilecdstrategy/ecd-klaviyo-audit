import { Check } from 'lucide-react';

interface Step {
  label: string;
  description: string;
}

interface AuditWizardStepperProps {
  steps: Step[];
  currentStep: number;
}

export default function AuditWizardStepper({ steps, currentStep }: AuditWizardStepperProps) {
  return (
    <div className="flex items-center gap-0">
      {steps.map((step, i) => {
        const isCompleted = i < currentStep;
        const isCurrent = i === currentStep;

        return (
          <div key={i} className="flex items-center flex-1">
            <div className="flex items-center gap-3 flex-1">
              <div
                className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-semibold shrink-0 transition-all ${
                  isCompleted
                    ? 'gradient-bg text-white'
                    : isCurrent
                    ? 'bg-brand-primary/10 text-brand-primary border-2 border-brand-primary'
                    : 'bg-gray-100 text-gray-400'
                }`}
              >
                {isCompleted ? <Check className="w-4 h-4" /> : i + 1}
              </div>
              <div className="hidden sm:block min-w-0">
                <p className={`text-sm font-medium truncate ${isCurrent ? 'text-gray-900' : 'text-gray-500'}`}>
                  {step.label}
                </p>
                <p className="text-xs text-gray-400 truncate">{step.description}</p>
              </div>
            </div>
            {i < steps.length - 1 && (
              <div className={`h-px flex-1 mx-4 ${isCompleted ? 'bg-brand-primary' : 'bg-gray-200'}`} />
            )}
          </div>
        );
      })}
    </div>
  );
}
