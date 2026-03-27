import { Fragment } from 'react';
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
    <div className="flex w-full min-w-0 items-center">
      {steps.map((step, i) => {
        const isCompleted = i < currentStep;
        const isCurrent = i === currentStep;
        const lineCompleted = i < currentStep;

        return (
          <Fragment key={i}>
            <div className="flex shrink-0 items-center gap-2 sm:gap-3">
              <div
                className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-semibold transition-all ${
                  isCompleted
                    ? 'gradient-bg text-white'
                    : isCurrent
                      ? 'border-2 border-brand-primary bg-brand-primary/10 text-brand-primary'
                      : 'bg-gray-100 text-gray-400'
                }`}
              >
                {isCompleted ? <Check className="h-4 w-4" /> : i + 1}
              </div>
              <div className="min-w-0">
                <p
                  className={`truncate text-xs font-medium sm:text-sm ${isCurrent ? 'text-gray-900' : 'text-gray-500'}`}
                >
                  {step.label}
                </p>
                <p className="hidden truncate text-xs text-gray-400 sm:block">{step.description}</p>
              </div>
            </div>
            {i < steps.length - 1 && (
              <div
                className={`mx-2 h-px min-h-px min-w-4 flex-1 sm:mx-4 ${lineCompleted ? 'bg-brand-primary' : 'bg-gray-200'}`}
                aria-hidden
              />
            )}
          </Fragment>
        );
      })}
    </div>
  );
}
