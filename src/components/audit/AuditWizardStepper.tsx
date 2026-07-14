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
    <div className="flex w-full min-w-0 items-center overflow-x-auto">
      {steps.map((step, i) => {
        const isCompleted = i < currentStep;
        const isCurrent = i === currentStep;
        const lineCompleted = i < currentStep;

        return (
          <Fragment key={i}>
            {/* Fixed-width step (circle + label): never grows, so the connecting
                lines below absorb all the extra space equally and stay even
                regardless of label length. */}
            <div className="flex shrink-0 items-center gap-2 sm:gap-2.5" title={step.description}>
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
              <p
                className={`whitespace-nowrap text-xs font-medium sm:text-sm ${isCurrent ? 'text-gray-900' : 'text-gray-500'}`}
              >
                {step.label}
              </p>
            </div>
            {i < steps.length - 1 && (
              <div
                className={`h-px min-h-px min-w-6 flex-1 self-center bg-gray-200 mx-2 sm:mx-3 ${lineCompleted ? '!bg-brand-primary' : ''}`}
                aria-hidden
              />
            )}
          </Fragment>
        );
      })}
    </div>
  );
}
