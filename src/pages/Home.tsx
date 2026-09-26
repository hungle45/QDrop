import { ArrowUpFromLine, ScanLine } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { ThemeToggle } from '@/components/common/theme-toggle'

export default function Home() {
  const navigate = useNavigate()

  return (
    <div className="flex-1 flex flex-col items-center justify-center p-6">
      <ThemeToggle className="fixed top-4 right-4" />

      <div className="max-w-lg w-full text-center space-y-12">
        <div className="space-y-4">
          <h1 className="text-5xl sm:text-6xl font-bold tracking-tight text-foreground">
            QDrop
          </h1>
          <p className="text-xl text-muted-foreground max-w-md mx-auto leading-relaxed">
            AirDrop, without the network.
          </p>
        </div>

        <Card className="border-border/50 bg-card/50 backdrop-blur-sm">
          <CardContent className="pt-6 pb-6 space-y-4">
            <p className="text-sm text-muted-foreground leading-relaxed">
              Transfer files between devices using QR codes.
              <br />
              No Wi-Fi. No Bluetooth. No server.
            </p>

            <SeparatorLine />

            <div className="flex flex-col sm:flex-row gap-3 justify-center pt-2">
              <Button
                size="lg"
                className="gap-2 text-base h-12 px-8"
                onClick={() => navigate('/send')}
              >
                <ArrowUpFromLine className="size-4" />
                Send Files
              </Button>
              <Button
                size="lg"
                variant="secondary"
                className="gap-2 text-base h-12 px-8"
                onClick={() => navigate('/receive')}
              >
                <ScanLine className="size-4" />
                Receive Files
              </Button>
            </div>
          </CardContent>
        </Card>

        <div className="grid grid-cols-3 gap-3 text-xs text-muted-foreground">
          <div className="flex flex-col items-center gap-1">
            <span className="text-foreground font-medium text-sm">Send</span>
            <span>Display QR codes</span>
          </div>
          <div className="flex flex-col items-center gap-1">
            <span className="text-foreground font-medium text-sm">Scan</span>
            <span>Read with camera</span>
          </div>
          <div className="flex flex-col items-center gap-1">
            <span className="text-foreground font-medium text-sm">Receive</span>
            <span>Reconstruct file</span>
          </div>
        </div>
      </div>
    </div>
  )
}

function SeparatorLine() {
  return <div className="border-t border-border/50" />
}